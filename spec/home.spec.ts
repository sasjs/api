/**
 * `GET /` - the interface's shell, and the one transform every host needs.
 *
 * The page is the host's file; the stamping is the package's. What is under test
 * is that a bundle reference carries the build's token, that prose and an
 * already-versioned reference are left alone, that applying the transform twice
 * is the same as applying it once, and that a host with no build answers a page
 * rather than an error.
 */
import {
  BUNDLE_NAME,
  NO_WEB_BUILD,
  createHomeService,
  withBundleVersion
} from '../src/home/service.js'
import type { WebPage } from '../src/home/service.js'
import { dispatch } from '../src/host/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { isApiError } from '../src/types.js'
import { routeById } from '../src/routes/index.js'

const page = (): WebPage => ({
  version: '4a26a3d1b2c3',
  html: [
    '<!doctype html>',
    '<html><head>',
    '  <script src="./index.bundle.js"></script>',
    "  <script src='index.bundle.js'></script>",
    // the built page writes it unquoted, which is just as valid
    '  <script src=./index.bundle.js></script>',
    '  <link rel="stylesheet" href="./index.bundle.js.css" />',
    '  <script src="./vendor.js?v=keepme"></script>',
    '</head><body>',
    '  <p>The page loads index.bundle.js beside it.</p>',
    '  <div id="root"></div>',
    '</body></html>'
  ].join('\n')
})

const refusal = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
    return 'resolved'
  } catch (error) {
    return (error as Error).message
  }
}

const drive = () => createDriveService(new MemoryDriveStore())

describe('the home service', () => {
  it('stamps a bundle reference, quoted or not, and leaves everything else', async () => {
    const answer = await createHomeService(async () => page()).home()

    expect(answer).toContain('src="./index.bundle.js?v=4a26a3d1b2c3"')
    expect(answer).toContain("src='index.bundle.js?v=4a26a3d1b2c3'")
    expect(answer).toContain('src=./index.bundle.js?v=4a26a3d1b2c3>')
    // a stylesheet whose name merely starts with the bundle's is another file
    expect(answer).toContain('href="./index.bundle.js.css"')
    // already versioned: untouched, so the transform stays idempotent
    expect(answer).toContain('src="./vendor.js?v=keepme"')
    // the bundle's name in prose stays prose
    expect(answer).toContain('The page loads index.bundle.js beside it.')
  })

  it('is idempotent: applying it twice is applying it once', () => {
    const once = withBundleVersion(page().html, 'token')
    expect(withBundleVersion(once, 'token')).toBe(once)
    // and a second, different token cannot double-stamp either
    expect(withBundleVersion(once, 'other')).toBe(once)
  })

  it('leaves a page with no bundle reference exactly as it is', () => {
    const html = '<html><body>nothing to stamp</body></html>'
    expect(withBundleVersion(html, 'token')).toBe(html)
  })

  it('answers the documented page when the host has no build', async () => {
    // a 404 would read as "this route is missing"; the route is the interface,
    // and an operator whose build did not land needs to see that in a browser
    expect(await createHomeService(async () => undefined).home()).toBe(
      NO_WEB_BUILD
    )
    expect(NO_WEB_BUILD).toContain('Web Build is not present')
  })

  it('refuses a page it cannot stamp into a resolving URL', async () => {
    expect(
      await refusal(() =>
        createHomeService(async () => ({ ...page(), html: '' })).home()
      )
    ).toContain('states no html')

    for (const version of [
      '',
      'has space',
      'q?mark',
      'hash#mark',
      // a quote would close the attribute the token is written into
      'a"b',
      "a'b",
      'amp&ersand',
      'slash/here'
    ]) {
      expect({
        version,
        message: await refusal(() =>
          createHomeService(async () => ({ ...page(), version })).home()
        )
      }).toEqual({
        version,
        message: expect.stringContaining("the bundle's cache token")
      })
    }

    expect(
      await refusal(() => createHomeService(async () => 'page' as never).home())
    ).toContain('is not an object')
  })
})

describe('the home route', () => {
  it('is carried, public, and states the status the document states', () => {
    // no body annotation: the usual 200 is the host's own page, and the fallback
    // is NO_WEB_BUILD - neither is a value a client keys on

    const route = routeById('GET /')

    expect(route?.implemented).toBe(true)
    expect(route?.reason).toBeUndefined()
    expect(route?.capabilities).toEqual([])
    expect(route?.responses.map((response) => response.status)).toEqual([200])
  })

  it('answers the page as a raw body, not JSON', async () => {
    const response = await dispatch(
      { drive: drive(), home: createHomeService(async () => page()) },
      'GET /'
    )

    expect(response.status).toBe(200)
    expect(response.body).toBeUndefined()
    expect(response.contents).toContain(`${BUNDLE_NAME}?v=4a26a3d1b2c3`)
  })

  it('answers 501, naming the missing service, when the host supplies none', async () => {
    try {
      await dispatch({ drive: drive() }, 'GET /')
      throw new Error('resolved')
    } catch (error) {
      expect(isApiError(error)).toBe(true)
      expect((error as { status: number }).status).toBe(501)
      expect((error as Error).message).toContain('has no home service')
    }
  })
})
