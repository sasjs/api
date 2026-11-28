import type { ApiResponse, Services } from '../host/dispatch.js'
import type { DriveService } from '../drive/service.js'
import type { Subject } from '../identity/types.js'
import type { TreeNode } from '../types.js'
import { ApiError } from '../types.js'
import { newUuidV4 } from '../uuid.js'
import { callerId, EMULATED_NOW, idFor } from './ids.js'

const prefix = '.sasjs-viya-job-'
const fileName = (id: string) => `${prefix}${id}.json`
const pattern =
  /^\.sasjs-viya-job-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/

export const isJobDefinitionFileName = (name: string): boolean =>
  pattern.test(name)

type Parameter = {
  name: string
  type: string
  defaultValue: string
  required: boolean
  version: number
}
type Definition = {
  id: string
  name: string
  code: string
  type: string
  parameters: Parameter[]
  createdBy: string
  modifiedBy: string
  creationTimeStamp: string
  modifiedTimeStamp: string
  version: number
  links: Array<{
    href: string
    uri: string
    rel: string
    method: string
    type: string
  }>
}

/** Read only explicitly marked, well-formed records; malformed files remain ordinary files. */
export const definitionFromFile = async (
  drive: DriveService,
  folder: string,
  name: string
): Promise<Definition | undefined> => {
  const match = pattern.exec(name)
  if (!match) return undefined
  const { contents } = await drive.read(
    `${folder}/${name}`.replace(/\/{2,}/g, '/')
  )
  if (typeof contents !== 'string') return undefined
  try {
    const value = JSON.parse(contents) as Definition
    if (
      !value ||
      value.id !== match[1] ||
      typeof value.name !== 'string' ||
      typeof value.code !== 'string' ||
      typeof value.type !== 'string' ||
      !Array.isArray(value.parameters) ||
      !Array.isArray(value.links)
    )
      return undefined
    return value
  } catch {
    return undefined
  }
}

const allNodes = (root: TreeNode): TreeNode[] => [
  root,
  ...root.children.flatMap(allNodes)
]

export const JOB_DEFINITION_HANDLERS: Record<
  string,
  (context: {
    services: Services
    request: {
      query?: Record<string, string | undefined>
      body?: unknown
      subject?: Subject
    }
    params: Record<string, string>
  }) => Promise<ApiResponse>
> = {
  'POST /jobDefinitions/definitions': async ({ services, request }) => {
    if (services.viya?.allowUntransactionalJobDefinitionCreation !== true)
      throw new ApiError(
        501,
        'Job definition creation requires an isolated host opt-in; Drive mutations are not transactional.'
      )
    const body = request.body as
      | { name?: unknown; type?: unknown; code?: unknown; parameters?: unknown }
      | undefined
    if (
      !body ||
      typeof body.name !== 'string' ||
      !body.name ||
      body.name === '.' ||
      body.name === '..' ||
      /[/\\\u0000-\u001f]/.test(body.name) ||
      typeof body.type !== 'string' ||
      typeof body.code !== 'string' ||
      !Array.isArray(body.parameters)
    )
      throw new ApiError(400, 'A name, type, code and parameters are required.')
    const parameters: Parameter[] = Array.from(
      body.parameters,
      (item: unknown) => {
        const param = item as {
          name?: unknown
          type?: unknown
          defaultValue?: unknown
          required?: unknown
        }
        if (
          !param ||
          typeof param.name !== 'string' ||
          typeof param.type !== 'string' ||
          typeof param.defaultValue !== 'string' ||
          (param.required !== undefined && typeof param.required !== 'boolean')
        )
          throw new ApiError(400, 'Invalid job parameter.')
        return {
          name: param.name,
          type: param.type,
          defaultValue: param.defaultValue,
          required: param.required ?? false,
          version: 1
        }
      }
    )
    const parent = request.query?.parentFolderUri
    const match =
      typeof parent === 'string'
        ? parent.match(/^\/folders\/folders\/([^/]+)$/)
        : undefined
    if (!match) throw new ApiError(400, 'A parent folder URI is required.')
    const drive = services.drive
    const nodes = allNodes((await drive.tree('/')).tree)
    const folder = nodes.find(
      (node) => node.isFolder && idFor(node.relativePath) === match[1]
    )
    if (!folder) throw new ApiError(404, 'Parent folder not found.')
    const listing = await drive.list(folder.relativePath)
    const existing = await Promise.all(
      listing.files.map((name) =>
        definitionFromFile(drive, folder.relativePath, name)
      )
    )
    if (existing.some((definition) => definition?.name === body.name))
      throw new ApiError(409, 'Job definition already exists.')
    const id = newUuidV4()
    const uri = `/jobDefinitions/definitions/${id}`
    const caller = callerId(request.subject)
    const definition: Definition = {
      id,
      name: body.name,
      type: body.type,
      code: body.code,
      parameters,
      version: 1,
      createdBy: caller,
      modifiedBy: caller,
      creationTimeStamp: EMULATED_NOW,
      modifiedTimeStamp: EMULATED_NOW,
      links: [
        {
          href: uri,
          uri,
          rel: 'self',
          method: 'GET',
          type: 'application/vnd.sas.job.definition'
        }
      ]
    }
    await drive.save(
      `${folder.relativePath}/${fileName(id)}`.replace(/\/{2,}/g, '/'),
      JSON.stringify(definition)
    )
    return { status: 201, body: definition }
  },
  'GET /jobDefinitions/definitions/{}': async ({ services, params }) => {
    const name = fileName(params.id)
    if (!pattern.test(name))
      throw new ApiError(404, 'Job definition not found.')
    const nodes = allNodes((await services.drive.tree('/')).tree)
    const node = nodes.find((item) => !item.isFolder && item.name === name)
    const folder = node?.relativePath.slice(0, -(name.length + 1)) || '/'
    const definition =
      node && (await definitionFromFile(services.drive, folder, name))
    if (!definition) throw new ApiError(404, 'Job definition not found.')
    return { status: 200, body: definition }
  }
}
