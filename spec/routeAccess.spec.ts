import {
  ALWAYS_VISIBLE_ROUTES,
  DEFAULT_GRANTABLE_ROUTES,
  isRouteGranted,
  topLevelRouteFor,
  TOP_LEVEL_ROUTES,
  type RouteRules
} from '../src/identity/routeAccess.js'

/**
 * The precedence ladder, one case per rung.
 *
 * `isRouteGranted` is the answer `GET /SASjsApi/info/myAuthorizedRoutes` gives
 * and the decision the gate makes when the route is requested, so the two cannot
 * drift apart - they are one function. The order below is the documented one,
 * and each case is written so that the *next* rung would answer differently: a
 * case that passes because nothing else was tried proves nothing.
 */
const PATH = '/SASjsApi/drive/file'
const TOP = '/SASjsApi'

const rules = (user: RouteRules['user'], group: RouteRules['group'] = []) => ({
  user,
  group
})

describe('the route access ladder', () => {
  it('lets a user grant on the path decide, against any group rule', () => {
    expect(
      isRouteGranted(
        rules(
          [{ path: PATH, setting: 'Grant' }],
          [{ path: PATH, setting: 'Deny' }]
        ),
        PATH
      )
    ).toBe(true)
  })

  it('lets a user deny on the path decide, against any group grant', () => {
    // the mirror of the case above: a user rule is final in both directions
    expect(
      isRouteGranted(
        rules(
          [{ path: PATH, setting: 'Deny' }],
          [{ path: PATH, setting: 'Grant' }]
        ),
        PATH
      )
    ).toBe(false)
  })

  it('falls back to a user rule on the top-level route', () => {
    expect(isRouteGranted(rules([{ path: TOP, setting: 'Grant' }]), PATH)).toBe(
      true
    )
    expect(isRouteGranted(rules([{ path: TOP, setting: 'Deny' }]), PATH)).toBe(
      false
    )
  })

  it('lets a group grant on the path allow', () => {
    expect(
      isRouteGranted(rules([], [{ path: PATH, setting: 'Grant' }]), PATH)
    ).toBe(true)
  })

  it('lets one group grant outvote another group deny at the same level', () => {
    // the reason step 3 looks at every group rule instead of stopping at the
    // first deny: two groups, opposite settings, and the grant wins
    expect(
      isRouteGranted(
        rules(
          [],
          [
            { path: PATH, setting: 'Deny' },
            { path: PATH, setting: 'Grant' }
          ]
        ),
        PATH
      )
    ).toBe(true)
  })

  it('refuses when the only group rule on the path is a deny', () => {
    expect(
      isRouteGranted(rules([], [{ path: PATH, setting: 'Deny' }]), PATH)
    ).toBe(false)
  })

  it('falls back to a group grant on the top-level route', () => {
    expect(
      isRouteGranted(rules([], [{ path: TOP, setting: 'Grant' }]), PATH)
    ).toBe(true)
    expect(
      isRouteGranted(rules([], [{ path: TOP, setting: 'Deny' }]), PATH)
    ).toBe(false)
  })

  it('refuses when there are no rules at all', () => {
    expect(isRouteGranted(rules([]), PATH)).toBe(false)
  })

  it('ignores a rule addressed to some other route', () => {
    expect(
      isRouteGranted(
        rules(
          [{ path: '/SASjsApi/drive/rename', setting: 'Grant' }],
          [{ path: '/SASjsApi/drive/folder', setting: 'Grant' }]
        ),
        PATH
      )
    ).toBe(false)
  })

  it('takes an explicit top-level route when the caller passes one', () => {
    expect(
      isRouteGranted(
        rules([{ path: '/AppStream', setting: 'Grant' }]),
        PATH,
        '/AppStream'
      )
    ).toBe(true)
  })
})

describe('the route a request is governed by', () => {
  it('is the top-level route the path sits under', () => {
    expect(topLevelRouteFor('/SASjsApi/code/execute')).toBe('/SASjsApi')
    expect(topLevelRouteFor('/AppStream/my-app')).toBe('/AppStream')
  })

  it('is case-insensitive, because a caller can type either', () => {
    expect(topLevelRouteFor('/sasjsapi/drive/file')).toBe('/SASjsApi')
  })

  it('is the path itself when it sits under no top-level route', () => {
    expect(topLevelRouteFor('/SASLogon/logout')).toBe('/SASLogon/logout')
  })
})

describe('the inventory a rule may address', () => {
  it('admits both top-level routes and the drive and execution routes', () => {
    expect(DEFAULT_GRANTABLE_ROUTES).toEqual(
      expect.arrayContaining([
        ...TOP_LEVEL_ROUTES,
        '/SASjsApi/code/execute',
        '/SASjsApi/drive/file',
        '/SASjsApi/drive/deploy/upload'
      ])
    )
  })

  it('holds /AppStream visible by rule, since it is the page that lists the rest', () => {
    expect(ALWAYS_VISIBLE_ROUTES).toEqual(['/AppStream'])
    expect(DEFAULT_GRANTABLE_ROUTES).toContain('/AppStream')
  })
})
