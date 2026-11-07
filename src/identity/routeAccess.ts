/**
 * Which routes a caller may use, from the permission rules alone.
 *
 * This is the answer `GET /SASjsApi/info/myAuthorizedRoutes` gives, and it is the
 * same decision the gate makes when the route is actually requested - a
 * web interface that offers a route the gate then refuses is the bug this exists
 * to prevent, so the two must not be two implementations. A host that gates its
 * own middleware should call `isRouteGranted` rather than re-derive it.
 */

/** The two top-level routes, which a rule can address to cover everything below. */
export const TOP_LEVEL_ROUTES = ['/AppStream', '/SASjsApi']

/**
 * Routes any authenticated caller may use whatever the rules say. `/AppStream` is
 * the navigation page whose job is to list the apps the caller may open, so
 * gating it on a grant that lists them would hide the page that leads to them.
 */
export const ALWAYS_VISIBLE_ROUTES = ['/AppStream']

/**
 * The routes that accept a rule, before a host adds its own. A host with
 * streamed applications extends this with `/AppStream/<app>` for each one, which
 * is why the inventory is passed in rather than derived from a fixed list here.
 */
export const STATIC_AUTHORIZED_ROUTES = [
  '/SASjsApi/code/execute',
  '/SASjsApi/stp/execute',
  '/SASjsApi/drive/deploy',
  '/SASjsApi/drive/deploy/upload',
  '/SASjsApi/drive/file',
  '/SASjsApi/drive/folder',
  '/SASjsApi/drive/fileTree',
  '/SASjsApi/drive/rename'
]

/** The route inventory when the host states no additions of its own. */
export const DEFAULT_GRANTABLE_ROUTES = [
  ...TOP_LEVEL_ROUTES,
  ...STATIC_AUTHORIZED_ROUTES
]

export interface RouteRule {
  path: string
  setting: string
}

/** The rules that can bear on one caller. */
export interface RouteRules {
  user: RouteRule[]
  group: RouteRule[]
}

/**
 * The top-level route that governs a request: `/SASjsApi/code/execute` is
 * governed by `/SASjsApi`, and a rule on the top-level route applies to
 * everything beneath it.
 */
export const topLevelRouteFor = (routePath: string): string =>
  TOP_LEVEL_ROUTES.find((route) =>
    routePath.toLowerCase().startsWith(route.toLowerCase())
  ) ?? routePath

const settingOn = (rules: RouteRule[], path: string): string | undefined =>
  rules.find((rule) => rule.path === path)?.setting

const GRANT = 'Grant'
const DENY = 'Deny'

/**
 * Whether these rules grant access to `path`.
 *
 * The order is the documented one and the only implementation of it:
 *
 *   1. a rule addressed to the user on the path itself decides either way;
 *   2. otherwise a rule addressed to the user on the top-level route decides;
 *   3. otherwise a group grant on the path allows, and a group deny on the path
 *      blocks the top-level check - but a grant from another group still allows;
 *   4. otherwise a group grant on the top-level route allows;
 *   5. otherwise denied.
 *
 * A grant beats a deny at the same level, which is why step 3 looks at every
 * group rule rather than stopping at the first deny.
 */
export const isRouteGranted = (
  rules: RouteRules,
  path: string,
  topLevelRoute: string = topLevelRouteFor(path)
): boolean => {
  const userSetting =
    settingOn(rules.user, path) ?? settingOn(rules.user, topLevelRoute)

  if (userSetting) return userSetting === GRANT

  const onPath = rules.group.filter((rule) => rule.path === path)

  if (onPath.some((rule) => rule.setting === GRANT)) return true
  if (onPath.some((rule) => rule.setting === DENY)) return false

  return rules.group.some(
    (rule) => rule.path === topLevelRoute && rule.setting === GRANT
  )
}
