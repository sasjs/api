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

  it('reads a manifest that arrived as bytes, which is how a zip carries it', () => {
    const code = Buffer.from(
      JSON.stringify({ name: 'zipped' }),
      'utf8'
    ).toString('base64')

    const bundle = splitAppBundle({
      members: [
        { name: APP_MANIFEST, type: 'file', encoding: 'base64', code },
        { name: 'index.html', type: 'file', code: '<html></html>' }
      ]
    })

    expect(bundle.manifest).toEqual({ name: 'zipped' })
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

  it('accepts a manifest that states any subset, and refuses only a field of the wrong shape', () => {
    for (const value of [null, [], 'x', 5])
      expect(() => parseAppManifest(value)).toThrow(/must be an object/)

    // a package names the app; a legacy bundle names the folder its assets are in.
    // Neither is required of the FILE, because the request may state them.
    expect(parseAppManifest({})).toEqual({})
    expect(parseAppManifest({ name: 'macrodash' })).toEqual({
      name: 'macrodash'
    })
    expect(parseAppManifest({ appLoc: '/Public/app/x' })).toEqual({
      appLoc: '/Public/app/x'
    })

    expect(() => parseAppManifest({ streamWebFolder: ' ' })).toThrow(
      /"streamWebFolder"/
    )
    expect(() => parseAppManifest({ streamWebFolder: 'a/b' })).toThrow(
      /single path segment/
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

describe('a package', () => {
  const file = (name: string, code = '') => ({
    name,
    type: 'file' as const,
    code
  })

  const packaged = (manifest: unknown, extra: unknown[] = []) =>
    treeWith(manifest, [
      {
        name: 'web',
        type: 'folder' as const,
        members: [file('index.html', '<html></html>'), file('main.js', 'x')]
      },
      ...extra
    ])

  it('splits the frontend from the backend by name, and strips the manifest', () => {
    const bundle = splitAppBundle(
      packaged({ name: 'macrodash', appLoc: '/Public/app/md' }, [
        {
          name: 'backend',
          type: 'folder' as const,
          members: [{ name: 'services', type: 'folder' as const, members: [] }]
        }
      ])
    )

    expect(bundle.manifest).toEqual({
      name: 'macrodash',
      appLoc: '/Public/app/md'
    })

    // the frontend is the CONTENTS of web/, because that is what becomes apps/<name>
    expect(bundle.frontend?.members.map((m) => m.name)).toEqual([
      'index.html',
      'main.js'
    ])

    // the backend is the CONTENTS of backend/, because that is what the services
    // deploy writes to appLoc
    expect(bundle.backend?.members.map((m) => m.name)).toEqual(['services'])
  })

  it('has no backend when the bundle carries none, and still has a frontend', () => {
    const bundle = splitAppBundle(packaged({ name: 'macrodash' }))

    expect(bundle.backend).toBeUndefined()
    expect(bundle.frontend?.members).toHaveLength(2)
  })

  it('is a frontend from the whole tree when a manifest names it and there is no web folder', () => {
    const bundle = splitAppBundle(
      treeWith({ name: 'alone' }, [file('index.html'), file('app.js')])
    )

    expect(bundle.manifest).toEqual({ name: 'alone' })
    expect(bundle.frontend?.members.map((m) => m.name)).toEqual([
      'index.html',
      'app.js'
    ])
  })

  it('is not a package when there is no web folder and no manifest', () => {
    const bundle = splitAppBundle(
      treeWith(undefined, [{ name: 'services', type: 'folder', members: [] }])
    )

    expect(bundle.frontend).toBeUndefined()
    expect(bundle.tree.members).toHaveLength(1)
  })
})

describe('the publish a package asks for', () => {
  it('names the app and leaves appLoc as the backend metadata it is', () => {
    expect(
      publishRequestFor(
        { name: 'macrodash', appLoc: '/Public/app/md' },
        undefined,
        { packaged: true }
      )
    ).toEqual({ name: 'macrodash', appLoc: '/Public/app/md' })
  })

  it('takes the manifest when the request is silent, and the request when it is not', () => {
    expect(
      publishRequestFor(
        {},
        { name: 'from-manifest', appLoc: '/Public/a' },
        {
          packaged: true
        }
      )
    ).toEqual({ name: 'from-manifest', appLoc: '/Public/a' })

    expect(
      publishRequestFor(
        { name: 'from-request' },
        { name: 'from-manifest' },
        {
          packaged: true
        }
      )
    ).toEqual({ name: 'from-request' })
  })

  it('asks for nothing when a bare bundle states no name', () => {
    expect(publishRequestFor({ appLoc: '/Public/a' })).toBeUndefined()
  })

  it('publishes a bare bundle as a frontend when the request names one', () => {
    expect(publishRequestFor({ name: 'bare' })).toEqual({ name: 'bare' })
  })

  it('keeps a stated stream folder on the legacy path, even in a package', () => {
    // the request wins: an entry that states where the assets sit is asking for the
    // shape it describes, which is why a CLI that has not been updated is unchanged
    expect(
      publishRequestFor(
        {
          appLoc: '/Public/a',
          streamWebFolder: 'web',
          streamServiceName: 'Old'
        },
        { name: 'ignored' },
        { packaged: true }
      )
    ).toEqual({
      appLoc: '/Public/a',
      streamWebFolder: 'web',
      name: 'Old'
    })
  })
})

describe('a manifest that names the older shape', () => {
  it('keeps the tree whole, even when a folder at its root is called web', () => {
    // `streamWebFolder` decides on its own. A folder called `web` is one a
    // deployment may simply contain, and reading it as a package would deploy half
    // a tree and publish the other half.
    const bundle = splitAppBundle({
      members: [
        {
          name: APP_MANIFEST,
          type: 'file',
          code: JSON.stringify({ streamWebFolder: 'web', appLoc: '/Public/a' })
        },
        {
          name: 'web',
          type: 'folder',
          members: [{ name: 'index.html', type: 'file', code: '<html></html>' }]
        },
        { name: 'services', type: 'folder', members: [] }
      ]
    })

    expect(bundle.frontend).toBeUndefined()
    expect(bundle.backend).toBeUndefined()
    expect(bundle.manifest).toEqual({
      streamWebFolder: 'web',
      appLoc: '/Public/a'
    })
    expect(bundle.tree.members.map((member) => member.name)).toEqual([
      'web',
      'services'
    ])
  })
})
