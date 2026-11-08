/**
 * The directory import behind `POST /authConfig/synchroniseWithLDAP`.
 *
 * The directory connection is the host's; the import is this package's. What is
 * under test is that a second run imports nothing, that existing accounts and
 * groups are left alone, that membership travels both ways in a directory
 * answer, and that a bad answer is refused before anything is written.
 */
import { createDirectoryService } from '../src/directory/service.js'
import type {
  DirectoryGroup,
  DirectorySource,
  DirectoryUser
} from '../src/directory/service.js'
import { MemoryIdentityStore } from '../src/identity/memory-store.js'
import { dispatch } from '../src/host/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { isApiError } from '../src/types.js'
import { DEFAULT_IDENTITY } from '../src/identity/fixture.js'
import { createDirectoryService as createDirectory } from '../src/directory/service.js'

const source = (
  users: DirectoryUser[],
  groups: DirectoryGroup[]
): DirectorySource => ({ users: async () => users, groups: async () => groups })

const store = () => new MemoryIdentityStore({ ...DEFAULT_IDENTITY })

const refusal = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
    return 'resolved'
  } catch (error) {
    return (error as Error).message
  }
}

describe('the directory import', () => {
  it('imports the users and groups that are not there, and counts them', async () => {
    const identity = store()
    identity.users().then((users) => expect(users.length).toBe(2))

    const result = await createDirectoryService(
      identity,
      source(
        [
          { username: 'alice', displayName: 'Alice' },
          { username: 'bob', displayName: 'Bob' }
        ],
        [{ name: 'analysts' }]
      )
    ).synchronise()

    expect(result).toEqual({ userCount: 2, groupCount: 1 })

    const users = await identity.users()
    expect(users.map((user) => user.username).sort()).toEqual([
      'admin',
      'alice',
      'bob',
      'user2'
    ])
    expect(users.find((user) => user.username === 'alice')?.authProvider).toBe(
      'ldap'
    )

    const groups = await identity.groups()
    expect(
      groups.find((group) => group.name === 'analysts')?.authProvider
    ).toBe('ldap')
  })

  it('leaves accounts and groups that already exist untouched', async () => {
    const identity = store()

    await createDirectoryService(
      identity,
      source(
        [{ username: 'alice', displayName: 'Alice' }],
        [{ name: 'analysts' }]
      )
    ).synchronise()

    const again = await createDirectoryService(
      identity,
      source(
        [
          // a renamed display name must not overwrite what the API already holds
          { username: 'alice', displayName: 'Alice Renamed' },
          { username: 'admin', displayName: 'Directory Admin' }
        ],
        [{ name: 'analysts' }, { name: 'admins' }]
      )
    ).synchronise()

    expect(again).toEqual({ userCount: 0, groupCount: 1 })

    const users = await identity.users()
    expect(users.find((user) => user.username === 'alice')?.displayName).toBe(
      'Alice'
    )
    expect(users.find((user) => user.username === 'admin')?.authProvider).toBe(
      undefined
    )
  })

  it('applies membership from both directions in the answer', async () => {
    const identity = store()

    await createDirectoryService(
      identity,
      source(
        [
          { username: 'alice', displayName: 'Alice', groups: ['analysts'] },
          { username: 'bob', displayName: 'Bob' }
        ],
        [
          { name: 'analysts', members: ['bob', 'admin', 'nobody'] },
          { name: 'readers', members: ['alice'] }
        ]
      )
    ).synchronise()

    const users = await identity.users()
    const uid = (username: string) =>
      users.find((user) => user.username === username)?.uid

    const analysts = await identity.groupByName('analysts')
    const readers = await identity.groupByName('readers')

    // alice from her own groups list, bob from the group's members, and admin
    // because the account already existed
    expect(new Set(analysts?.users)).toEqual(
      new Set([uid('alice'), uid('bob'), uid('admin')])
    )
    // `nobody` is not an account this API holds, so it is not invented
    expect(analysts?.users).not.toContain(undefined)
    expect(new Set(readers?.users)).toEqual(new Set([uid('alice')]))
  })

  it('does not touch the membership of an existing group', async () => {
    const identity = store()

    await createDirectoryService(
      identity,
      source(
        [{ username: 'alice', displayName: 'Alice' }],
        [{ name: 'DCGroup', members: ['alice'] }]
      )
    ).synchronise()

    const group = await identity.groupByName('DCGroup')
    const users = await identity.users()
    const alice = users.find((user) => user.username === 'alice')

    // DCGroup is in the default fixture with user2 in it; importing does not
    // reconcile, so alice is not added and user2 stays
    expect(group?.users).not.toContain(alice?.uid)
    expect(group?.users).toHaveLength(1)
  })

  it('refuses a directory answer it cannot import without guessing', async () => {
    const identity = store()

    expect(
      await refusal(() =>
        createDirectoryService(
          identity,
          source(
            [
              { username: 'alice', displayName: 'Alice' },
              { username: 'alice', displayName: 'Alice Again' }
            ],
            []
          )
        ).synchronise()
      )
    ).toContain('names alice twice')

    expect(
      await refusal(() =>
        createDirectoryService(
          identity,
          source([{ username: '', displayName: 'Nobody' }], [])
        ).synchronise()
      )
    ).toContain('without a username or displayName')

    expect(
      await refusal(() =>
        createDirectoryService(
          identity,
          source([], [{ name: 'analysts' }, { name: 'analysts' }])
        ).synchronise()
      )
    ).toContain('names the group analysts twice')

    expect(
      await refusal(() =>
        createDirectoryService(identity, {
          users: async () => 'nobody' as never,
          groups: async () => []
        }).synchronise()
      )
    ).toContain('no users array')

    expect(
      await refusal(() =>
        createDirectoryService(identity, {
          users: async () => [],
          groups: async () => 'none' as never
        }).synchronise()
      )
    ).toContain('no groups array')

    expect(
      await refusal(() =>
        createDirectoryService(
          identity,
          source([], [{ name: '' }])
        ).synchronise()
      )
    ).toContain('a group without a name')

    // and nothing was written by any of the refusals
    expect((await identity.users()).length).toBe(2)
  })

  it('stamps the provider the host names', async () => {
    const identity = store()

    await createDirectoryService(
      identity,
      source([{ username: 'alice', displayName: 'Alice' }], []),
      { provider: 'activedirectory' }
    ).synchronise()

    const alice = (await identity.users()).find(
      (user) => user.username === 'alice'
    )
    expect(alice?.authProvider).toBe('activedirectory')
  })

  describe('the directory route', () => {
    it('answers 200 with what it imported', async () => {
      const identity = store()

      const response = await dispatch(
        {
          drive: createDriveService(new MemoryDriveStore()),
          directory: createDirectory(
            identity,
            source([{ username: 'alice', displayName: 'Alice' }], [])
          )
        },
        'POST /SASjsApi/authConfig/synchroniseWithLDAP'
      )

      expect(response).toEqual({
        status: 200,
        body: { userCount: 1, groupCount: 0 }
      })
    })

    it('answers 501, naming the missing service, when the host supplies none', async () => {
      try {
        await dispatch(
          { drive: createDriveService(new MemoryDriveStore()) },
          'POST /SASjsApi/authConfig/synchroniseWithLDAP'
        )
        throw new Error('resolved')
      } catch (error) {
        expect(isApiError(error)).toBe(true)
        expect((error as { status: number }).status).toBe(501)
        expect((error as Error).message).toContain('has no directory service')
      }
    })
  })
})
