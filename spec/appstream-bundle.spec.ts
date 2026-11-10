import {
  APP_MANIFEST,
  parseAppManifest,
  publishRequestFor,
  splitAppBundle
} from '../src/appstream/bundle'

const treeWith = (manifest?: unknown, extra: unknown[] = []) => ({
  members: [
    ...(manifest === undefined
      ? []
      : [
          {
            name: APP_MANIFEST,
            type: 'file' as const,
            code:
              typeof manifest === 'string' ? manifest : JSON.stringify(manifest)
          }
        ]),
    ...extra
  ]
})

describe('an app bundle', () => {
  it('is a tree, when it says nothing about being an app', () => {
    const tree = treeWith(undefined, [
      { name: 'run', type: 'service', code: '' }
    ])
    const bundle = splitAppBundle(tree)

    expect(bundle.manifest).toBeUndefined()
    expect(bundle.tree).toBe(tree)
  })

  it('is the manifest plus the deployment, with the manifest taken out', () => {
    const run = { name: 'run', type: 'service', code: '%put hi;' }
    const tree = treeWith({ streamWebFolder: 'web' }, [run])
    const bundle = splitAppBundle(tree)

    expect(bundle.manifest).toEqual({ streamWebFolder: 'web' })
    expect(bundle.tree.members).toEqual([run])
    // the tree it was handed is not the tree it deployed, so a caller that keeps
    // its own copy does not see the manifest vanish from it
    expect(tree.members).toHaveLength(2)
  })

  it('keeps a manifest that is not at the root out of the index', () => {
    const nested = {
      members: [
        {
          name: 'services',
          type: 'folder',
          members: [
            {
              name: APP_MANIFEST,
              type: 'file',
              code: JSON.stringify({ streamWebFolder: 'web' })
            }
          ]
        }
      ]
    }

    const bundle = splitAppBundle(nested)

    expect(bundle.manifest).toBeUndefined()
    expect(bundle.tree.members).toHaveLength(1)
  })

  it('passes a tree that is not a tree to the deploy, which refuses it', () => {
    for (const value of [undefined, null, 'x', { members: 1 }])
      expect(splitAppBundle(value).tree).toBe(value)
  })

  it('refuses a manifest that cannot be read, naming the file', () => {
    expect(() => splitAppBundle(treeWith('{not json'))).toThrow(
      /sasjs\.app\.json is not valid JSON/
    )

    expect(() =>
      splitAppBundle({
        members: [{ name: APP_MANIFEST, type: 'file', code: 5 }]
      })
    ).toThrow(/carries no text/)
  })
})

describe('the manifest', () => {
  it('states the folder the compiled app is in, and nothing else it does not need', () => {
    expect(parseAppManifest({ streamWebFolder: 'web' })).toEqual({
      streamWebFolder: 'web'
    })

    expect(
      parseAppManifest({
        name: ' Mario ',
        streamWebFolder: 'web',
        logo: 'logo.png',
        frameAncestors: 'https://example.com'
      })
    ).toEqual({
      name: 'Mario',
      streamWebFolder: 'web',
      logo: 'logo.png',
      frameAncestors: 'https://example.com'
    })
  })

  it('refuses a manifest that is not an object, or names no folder', () => {
    for (const value of [null, [], 'x', 5])
      expect(() => parseAppManifest(value)).toThrow(/must be an object/)

    expect(() => parseAppManifest({})).toThrow(/"streamWebFolder"/)
    expect(() => parseAppManifest({ streamWebFolder: ' ' })).toThrow(
      /"streamWebFolder"/
    )
  })

  it('refuses a field of the wrong shape, naming that field', () => {
    expect(() =>
      parseAppManifest({ streamWebFolder: 'web', name: '' })
    ).toThrow(/"name"/)

    expect(() => parseAppManifest({ streamWebFolder: 'web', logo: 5 })).toThrow(
      /"logo"/
    )

    for (const frames of [[], [''], [5], 5, ''])
      expect(() =>
        parseAppManifest({ streamWebFolder: 'web', frameAncestors: frames })
      ).toThrow(/"frameAncestors"/)
  })
})

describe('the publish a deploy asks for', () => {
  it('is nothing when neither the request nor the bundle names a stream folder', () => {
    expect(publishRequestFor({ appLoc: '/Public/a' })).toBeUndefined()
  })

  it('takes the bundle when the request is silent', () => {
    expect(
      publishRequestFor(
        { appLoc: '/Public/a' },
        {
          streamWebFolder: 'web',
          name: 'Mario',
          logo: 'logo.png',
          frameAncestors: ['https://example.com']
        }
      )
    ).toEqual({
      appLoc: '/Public/a',
      streamWebFolder: 'web',
      name: 'Mario',
      logo: 'logo.png',
      frameAncestors: ['https://example.com']
    })
  })

  it('lets the request correct the bundle', () => {
    expect(
      publishRequestFor(
        {
          appLoc: '/Public/a',
          streamWebFolder: 'dist',
          streamServiceName: 'Named',
          streamLogo: 'other.png'
        },
        { streamWebFolder: 'web', name: 'Mario', logo: 'logo.png' }
      )
    ).toEqual({
      appLoc: '/Public/a',
      streamWebFolder: 'dist',
      name: 'Named',
      logo: 'other.png'
    })
  })
})
