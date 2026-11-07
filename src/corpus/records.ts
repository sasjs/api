/**
 * The administration routes' conformance corpus: users, groups, permission rules
 * and clients, as requests in and answers out.
 *
 * Every status the document states for these routes has a case here - that is
 * what `spec/corpus-parity.spec.ts` enforces in both directions - so a refusal
 * is part of the contract rather than something a reader has to infer from the
 * controller.
 *
 * The fixtures are small on purpose: one administrator, one restricted user, the
 * two groups they belong to, three rules, and - for the refusals that only an
 * externally-managed account can provoke - a provider-managed user and group and
 * the reserved `public` group.
 */
import type { CorpusCase } from './drive.js'
import {
  DEFAULT_IDENTITY,
  type IdentityFixture,
  type IdentityFixtureToken
} from '../identity/fixture.js'

/** The admin and the restricted user, signed in. */
const SIGNED_IN_TOKENS: IdentityFixtureToken[] = [
  {
    username: 'admin',
    clientId: 'web_app',
    accessToken: 'admin-access',
    refreshToken: 'admin-refresh'
  },
  {
    username: 'user2',
    clientId: 'web_app',
    accessToken: 'user-access',
    refreshToken: 'user-refresh'
  }
]

/** The default identity, with an administrator and the restricted user signed in. */
export const ADMIN_SIGNED_IN: IdentityFixture = {
  ...DEFAULT_IDENTITY,
  tokens: SIGNED_IN_TOKENS
}

/**
 * The same identity, plus what the provider and public-group refusals need: an
 * account and a group managed by an external provider, and the reserved group.
 */
export const PROVIDER_MANAGED: IdentityFixture = {
  ...ADMIN_SIGNED_IN,
  tokens: [
    ...SIGNED_IN_TOKENS,
    {
      username: 'diruser',
      clientId: 'web_app',
      accessToken: 'dir-access',
      refreshToken: 'dir-refresh'
    }
  ],
  users: [
    ...ADMIN_SIGNED_IN.users,
    {
      uid: 'user-directory',
      username: 'diruser',
      displayName: 'Directory User',
      password: 'dir123',
      isAdmin: false,
      isActive: true,
      needsToUpdatePassword: false,
      authProvider: 'oidc'
    }
  ],
  groups: [
    ...ADMIN_SIGNED_IN.groups,
    {
      uid: 'group-directory',
      name: 'Directory',
      description: 'Managed by the directory',
      isActive: true,
      users: [],
      authProvider: 'oidc'
    },
    {
      uid: 'group-public',
      name: 'public',
      description: 'Everyone',
      isActive: true,
      users: []
    }
  ]
}

const ADMIN = 'admin-access'
const RESTRICTED = 'user-access'
const RESTRICTED_UID = 'user-restricted'
const ADMIN_UID = 'user-admin'

export const RECORD_CORPUS: CorpusCase[] = [
  // ------------------------------------------------------------------ users
  {
    id: 'list-users',
    route: 'GET /SASjsApi/user',
    description: 'lists the accounts any signed-in caller may see',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN },
    expect: {
      status: 200,
      body: [
        {
          uid: ADMIN_UID,
          username: 'admin',
          displayName: 'Demo Admin',
          isAdmin: true
        },
        {
          uid: RESTRICTED_UID,
          username: 'user2',
          displayName: 'Demo User',
          isAdmin: false
        }
      ]
    }
  },
  {
    id: 'get-user-self',
    route: 'GET /SASjsApi/user/{uid}',
    description:
      'returns the caller their own details, with the auto-exec code',
    identity: ADMIN_SIGNED_IN,
    request: { token: RESTRICTED, params: { uid: RESTRICTED_UID } },
    expect: {
      status: 200,
      partial: {
        uid: RESTRICTED_UID,
        username: 'user2',
        isActive: true,
        isAdmin: false,
        autoExec: ''
      }
    }
  },
  {
    id: 'get-user-unauthenticated',
    route: 'GET /SASjsApi/user/{uid}',
    description: 'refuses a read with no caller at all',
    identity: ADMIN_SIGNED_IN,
    request: { params: { uid: RESTRICTED_UID } },
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'get-user-missing',
    route: 'GET /SASjsApi/user/{uid}',
    description: 'answers 404 for an identifier no account has',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN, params: { uid: 'user-none' } },
    expect: { status: 404, error: 'User is not found.' }
  },
  {
    id: 'get-user-by-username',
    route: 'GET /SASjsApi/user/by/username/{username}',
    description: 'finds an account by username',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN, params: { username: 'user2' } },
    expect: {
      status: 200,
      partial: { uid: RESTRICTED_UID, username: 'user2', isAdmin: false }
    }
  },
  {
    id: 'get-user-by-username-unauthenticated',
    route: 'GET /SASjsApi/user/by/username/{username}',
    description: 'refuses the by-username read with no caller',
    identity: ADMIN_SIGNED_IN,
    request: { params: { username: 'user2' } },
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'get-user-by-username-missing',
    route: 'GET /SASjsApi/user/by/username/{username}',
    description: 'answers 404 for a username no account has',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN, params: { username: 'nobody' } },
    expect: { status: 404, error: 'User is not found.' }
  },
  {
    id: 'create-user',
    route: 'POST /SASjsApi/user',
    description: 'creates an account, sanitised, and reports it',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      body: {
        username: 'newuser',
        displayName: '  New\u0001 User  ',
        password: 'newpass',
        isAdmin: false,
        isActive: true
      }
    },
    expect: {
      status: 200,
      partial: {
        username: 'newuser',
        displayName: 'New User',
        isAdmin: false,
        isActive: true
      }
    }
  },
  {
    id: 'create-user-not-admin',
    route: 'POST /SASjsApi/user',
    description: 'refuses a creation by a caller who is not an administrator',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: RESTRICTED,
      body: {
        username: 'newuser',
        displayName: 'New User',
        password: 'newpass'
      }
    },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'create-user-anonymous-incomplete',
    route: 'POST /SASjsApi/user',
    description: 'answers 401 before the payload schema, anonymously and empty',
    identity: ADMIN_SIGNED_IN,
    request: { body: {} },
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'create-user-duplicate',
    route: 'POST /SASjsApi/user',
    description: 'refuses a username that is taken',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      body: { username: 'user2', displayName: 'Another', password: 'newpass' }
    },
    expect: { status: 409, error: 'Username already exists.' }
  },

  {
    id: 'update-user',
    route: 'PATCH /SASjsApi/user/{uid}',
    description: "changes an account's display name",
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      params: { uid: RESTRICTED_UID },
      body: {
        displayName: 'Renamed User',
        username: 'user2',
        password: 'user123'
      }
    },
    expect: {
      status: 200,
      partial: { uid: RESTRICTED_UID, displayName: 'Renamed User' }
    }
  },
  {
    id: 'update-user-not-admin',
    route: 'PATCH /SASjsApi/user/{uid}',
    description: "refuses a change to somebody else's account",
    identity: ADMIN_SIGNED_IN,
    request: {
      token: RESTRICTED,
      params: { uid: ADMIN_UID },
      body: { displayName: 'Hijacked', username: 'admin', password: 'admin123' }
    },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'update-user-missing',
    route: 'PATCH /SASjsApi/user/{uid}',
    description: 'answers 404 with the identifier it looked up',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      params: { uid: 'user-none' },
      body: { displayName: 'Nobody', username: 'nobody', password: 'none123' }
    },
    expect: { status: 404, error: 'Unable to find user with user-none' }
  },
  {
    id: 'update-user-provider',
    route: 'PATCH /SASjsApi/user/{uid}',
    description: 'refuses a username change on a provider-managed account',
    identity: PROVIDER_MANAGED,
    request: {
      token: ADMIN,
      params: { uid: 'user-directory' },
      body: {
        username: 'renamed',
        displayName: 'Directory User',
        password: 'dir123'
      }
    },
    expect: {
      status: 405,
      error:
        'Can not update username of user that is created by an external auth provider.'
    }
  },
  {
    id: 'update-user-username-taken',
    route: 'PATCH /SASjsApi/user/{uid}',
    description: 'refuses a username another account already has',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      params: { uid: RESTRICTED_UID },
      body: { username: 'admin', displayName: 'Demo User', password: 'user123' }
    },
    expect: { status: 409, error: 'Username already exists.' }
  },
  {
    id: 'update-user-by-username',
    route: 'PATCH /SASjsApi/user/by/username/{username}',
    description: 'changes an account looked up by username',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      params: { username: 'user2' },
      body: {
        isActive: false,
        username: 'user2',
        displayName: 'Demo User',
        password: 'user123'
      }
    },
    expect: { status: 200, partial: { username: 'user2', isActive: false } }
  },
  {
    id: 'update-user-by-username-not-admin',
    route: 'PATCH /SASjsApi/user/by/username/{username}',
    description: 'refuses a change to another account by username',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: RESTRICTED,
      params: { username: 'admin' },
      body: { displayName: 'Hijacked', username: 'admin', password: 'admin123' }
    },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'update-user-by-username-missing',
    route: 'PATCH /SASjsApi/user/by/username/{username}',
    description: 'answers 404 with the username it looked up',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      params: { username: 'nobody' },
      body: { displayName: 'Nobody', username: 'nobody', password: 'none123' }
    },
    expect: { status: 404, error: 'Unable to find user with nobody' }
  },
  {
    id: 'update-user-by-username-provider',
    route: 'PATCH /SASjsApi/user/by/username/{username}',
    description: 'refuses a display-name change on a provider-managed account',
    identity: PROVIDER_MANAGED,
    request: {
      token: ADMIN,
      params: { username: 'diruser' },
      body: { displayName: 'Renamed', username: 'diruser', password: 'dir123' }
    },
    expect: {
      status: 405,
      error:
        'Can not update display name of user that is created by an external auth provider.'
    }
  },
  {
    id: 'update-user-by-username-taken',
    route: 'PATCH /SASjsApi/user/by/username/{username}',
    description: 'refuses a username another account already has',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      params: { username: 'user2' },
      body: { username: 'admin', displayName: 'Demo User', password: 'user123' }
    },
    expect: { status: 409, error: 'Username already exists.' }
  },

  {
    id: 'delete-user',
    route: 'DELETE /SASjsApi/user/{uid}',
    description: 'deletes an account as an administrator, without a password',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN, params: { uid: RESTRICTED_UID }, body: {} },
    expect: { status: 200, body: 'Account Deleted!' }
  },
  {
    id: 'delete-user-not-admin',
    route: 'DELETE /SASjsApi/user/{uid}',
    description: "refuses a deletion of somebody else's account",
    identity: ADMIN_SIGNED_IN,
    request: { token: RESTRICTED, params: { uid: ADMIN_UID }, body: {} },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'delete-user-missing',
    route: 'DELETE /SASjsApi/user/{uid}',
    description: 'answers 404 for an identifier no account has',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN, params: { uid: 'user-none' }, body: {} },
    expect: { status: 404, error: 'User is not found.' }
  },
  {
    id: 'delete-user-by-username',
    route: 'DELETE /SASjsApi/user/by/username/{username}',
    description: 'deletes an account looked up by username',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      params: { username: 'user2' },
      body: {}
    },
    expect: { status: 200, body: 'Account Deleted!' }
  },
  {
    id: 'delete-user-by-username-wrong-password',
    route: 'DELETE /SASjsApi/user/by/username/{username}',
    description: 'refuses a self-deletion whose password is wrong',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: RESTRICTED,
      params: { username: 'user2' },
      body: { password: 'wrong123' }
    },
    expect: { status: 401, error: 'Invalid password.' }
  },
  {
    id: 'delete-user-by-username-missing',
    route: 'DELETE /SASjsApi/user/by/username/{username}',
    description: 'answers 404 for a username no account has',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN, params: { username: 'nobody' }, body: {} },
    expect: { status: 404, error: 'User is not found.' }
  },

  // ----------------------------------------------------------------- groups
  {
    id: 'list-groups',
    route: 'GET /SASjsApi/group',
    description: 'lists the groups',
    identity: ADMIN_SIGNED_IN,
    request: { token: RESTRICTED },
    expect: {
      status: 200,
      body: [
        {
          uid: 'group-data-controller',
          name: 'DCGroup',
          description: 'Data Controller users'
        },
        {
          uid: 'group-admins',
          name: 'Admins',
          description: 'Everything the API offers'
        }
      ]
    }
  },
  {
    id: 'get-group',
    route: 'GET /SASjsApi/group/{uid}',
    description: 'returns a group and its members',
    identity: ADMIN_SIGNED_IN,
    request: { token: RESTRICTED, params: { uid: 'group-admins' } },
    expect: {
      status: 200,
      partial: {
        uid: 'group-admins',
        name: 'Admins',
        isActive: true,
        users: [
          {
            uid: ADMIN_UID,
            username: 'admin',
            displayName: 'Demo Admin',
            isAdmin: true
          }
        ]
      }
    }
  },
  {
    id: 'get-group-missing',
    route: 'GET /SASjsApi/group/{uid}',
    description: 'answers 404 for an identifier no group has',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN, params: { uid: 'group-none' } },
    expect: { status: 404, error: 'Group not found.' }
  },
  {
    id: 'get-group-by-name',
    route: 'GET /SASjsApi/group/by/groupname/{name}',
    description: 'finds a group by name',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN, params: { name: 'DCGroup' } },
    expect: {
      status: 200,
      partial: { uid: 'group-data-controller', name: 'DCGroup' }
    }
  },
  {
    id: 'get-group-by-name-missing',
    route: 'GET /SASjsApi/group/by/groupname/{name}',
    description: 'answers 404 for a name no group has',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN, params: { name: 'nope' } },
    expect: { status: 404, error: 'Group not found.' }
  },
  {
    id: 'create-group',
    route: 'POST /SASjsApi/group',
    description: 'creates a group with no members',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      body: { name: 'NewGroup', description: 'A new group', isActive: true }
    },
    expect: {
      status: 200,
      partial: {
        name: 'NewGroup',
        description: 'A new group',
        isActive: true,
        users: []
      }
    }
  },
  {
    id: 'create-group-not-admin',
    route: 'POST /SASjsApi/group',
    description: 'refuses a creation by a caller who is not an administrator',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: RESTRICTED,
      body: { name: 'NewGroup', description: 'x' }
    },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'create-group-duplicate',
    route: 'POST /SASjsApi/group',
    description: 'refuses a name that is taken',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN, body: { name: 'DCGroup', description: 'again' } },
    expect: { status: 409, error: 'Group name already exists.' }
  },

  {
    id: 'add-user-to-group',
    route: 'POST /SASjsApi/group/{groupUid}/{userUid}',
    description: 'adds a member and returns the group',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      params: { groupUid: 'group-admins', userUid: RESTRICTED_UID }
    },
    expect: {
      status: 200,
      partial: { uid: 'group-admins', name: 'Admins' }
    }
  },
  {
    id: 'add-user-to-public-group',
    route: 'POST /SASjsApi/group/{groupUid}/{userUid}',
    description: 'refuses a change to the reserved public group',
    identity: PROVIDER_MANAGED,
    request: {
      token: ADMIN,
      params: { groupUid: 'group-public', userUid: RESTRICTED_UID }
    },
    expect: { status: 400, error: "Can't add/remove user to 'public' group." }
  },
  {
    id: 'add-user-to-group-not-admin',
    route: 'POST /SASjsApi/group/{groupUid}/{userUid}',
    description: 'refuses a membership change by a non-administrator',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: RESTRICTED,
      params: { groupUid: 'group-admins', userUid: RESTRICTED_UID }
    },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'add-user-to-group-missing-group',
    route: 'POST /SASjsApi/group/{groupUid}/{userUid}',
    description: 'answers 404 for a group that does not exist',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      params: { groupUid: 'group-none', userUid: RESTRICTED_UID }
    },
    expect: { status: 404, error: 'Group not found.' }
  },
  {
    id: 'add-user-to-group-provider',
    route: 'POST /SASjsApi/group/{groupUid}/{userUid}',
    description: 'refuses a membership change on a provider-managed group',
    identity: PROVIDER_MANAGED,
    request: {
      token: ADMIN,
      params: { groupUid: 'group-directory', userUid: RESTRICTED_UID }
    },
    expect: {
      status: 405,
      error: "Can't add/remove user to group created by external auth provider."
    }
  },

  {
    id: 'remove-user-from-group',
    route: 'DELETE /SASjsApi/group/{groupUid}/{userUid}',
    description: 'removes a member and returns the group',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      params: { groupUid: 'group-data-controller', userUid: RESTRICTED_UID }
    },
    expect: {
      status: 200,
      partial: { uid: 'group-data-controller', name: 'DCGroup', users: [] }
    }
  },
  {
    id: 'add-provider-user-to-group',
    route: 'POST /SASjsApi/group/{groupUid}/{userUid}',
    description: 'refuses a membership change for a provider-managed user',
    identity: PROVIDER_MANAGED,
    request: {
      token: ADMIN,
      params: { groupUid: 'group-admins', userUid: 'user-directory' }
    },
    expect: {
      status: 405,
      error: "Can't add/remove user to group created by external auth provider."
    }
  },
  {
    id: 'remove-provider-user-from-group',
    route: 'DELETE /SASjsApi/group/{groupUid}/{userUid}',
    description: 'refuses a membership change for a provider-managed user',
    identity: PROVIDER_MANAGED,
    request: {
      token: ADMIN,
      params: { groupUid: 'group-admins', userUid: 'user-directory' }
    },
    expect: {
      status: 405,
      error: "Can't add/remove user to group created by external auth provider."
    }
  },
  {
    id: 'remove-user-from-public-group',
    route: 'DELETE /SASjsApi/group/{groupUid}/{userUid}',
    description: 'refuses a change to the reserved public group',
    identity: PROVIDER_MANAGED,
    request: {
      token: ADMIN,
      params: { groupUid: 'group-public', userUid: RESTRICTED_UID }
    },
    expect: { status: 400, error: "Can't add/remove user to 'public' group." }
  },
  {
    id: 'remove-user-from-group-not-admin',
    route: 'DELETE /SASjsApi/group/{groupUid}/{userUid}',
    description: 'refuses a membership change by a non-administrator',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: RESTRICTED,
      params: { groupUid: 'group-data-controller', userUid: RESTRICTED_UID }
    },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'remove-user-from-group-missing-user',
    route: 'DELETE /SASjsApi/group/{groupUid}/{userUid}',
    description: 'answers 404 for a member that does not exist',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      params: { groupUid: 'group-admins', userUid: 'user-none' }
    },
    expect: { status: 404, error: 'User not found.' }
  },
  {
    id: 'remove-user-from-group-provider',
    route: 'DELETE /SASjsApi/group/{groupUid}/{userUid}',
    description: 'refuses a membership change on a provider-managed group',
    identity: PROVIDER_MANAGED,
    request: {
      token: ADMIN,
      params: { groupUid: 'group-directory', userUid: RESTRICTED_UID }
    },
    expect: {
      status: 405,
      error: "Can't add/remove user to group created by external auth provider."
    }
  },

  {
    id: 'delete-group',
    route: 'DELETE /SASjsApi/group/{uid}',
    description: 'deletes a group',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN, params: { uid: 'group-data-controller' } },
    expect: { status: 200 }
  },
  {
    id: 'delete-group-not-admin',
    route: 'DELETE /SASjsApi/group/{uid}',
    description: 'refuses a deletion by a caller who is not an administrator',
    identity: ADMIN_SIGNED_IN,
    request: { token: RESTRICTED, params: { uid: 'group-admins' } },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'delete-group-missing',
    route: 'DELETE /SASjsApi/group/{uid}',
    description: 'answers 404 for an identifier no group has',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN, params: { uid: 'group-none' } },
    expect: { status: 404, error: 'Group not found.' }
  },

  // ------------------------------------------------------------ permissions
  {
    id: 'list-permissions-as-admin',
    route: 'GET /SASjsApi/permission',
    description: 'returns every rule to an administrator',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN },
    expect: {
      status: 200,
      body: [
        {
          uid: 'rule-routes',
          path: '/SASjsApi/drive/file',
          type: 'Route',
          setting: 'Grant',
          group: 'group-data-controller'
        },
        {
          uid: 'rule-execute',
          path: '/SASjsApi/stp/execute',
          type: 'Route',
          setting: 'Grant',
          group: 'group-data-controller'
        },
        {
          uid: 'rule-code',
          path: '/SASjsApi/code/execute',
          type: 'Route',
          setting: 'Deny',
          user: RESTRICTED_UID
        }
      ]
    }
  },
  {
    id: 'list-permissions-as-user',
    route: 'GET /SASjsApi/permission',
    description: "returns a caller only their own rules and their groups'",
    identity: ADMIN_SIGNED_IN,
    request: { token: RESTRICTED },
    expect: {
      status: 200,
      body: [
        {
          uid: 'rule-routes',
          path: '/SASjsApi/drive/file',
          type: 'Route',
          setting: 'Grant',
          group: 'group-data-controller'
        },
        {
          uid: 'rule-execute',
          path: '/SASjsApi/stp/execute',
          type: 'Route',
          setting: 'Grant',
          group: 'group-data-controller'
        },
        {
          uid: 'rule-code',
          path: '/SASjsApi/code/execute',
          type: 'Route',
          setting: 'Deny',
          user: RESTRICTED_UID
        }
      ]
    }
  },
  {
    id: 'list-permissions-unauthenticated',
    route: 'GET /SASjsApi/permission',
    description: 'refuses the list with no caller',
    identity: ADMIN_SIGNED_IN,
    request: {},
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'create-permission-user',
    route: 'POST /SASjsApi/permission',
    description: 'creates a rule for a user',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      body: {
        path: '/SASjsApi/drive/folder',
        type: 'Route',
        setting: 'Grant',
        principalType: 'user',
        principalId: RESTRICTED_UID
      }
    },
    expect: {
      status: 200,
      partial: { path: '/SASjsApi/drive/folder', setting: 'Grant' }
    }
  },
  {
    id: 'create-permission-group',
    route: 'POST /SASjsApi/permission',
    description: 'creates a rule for a group',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      body: {
        path: '/SASjsApi/drive/rename',
        type: 'Route',
        setting: 'Grant',
        principalType: 'group',
        principalId: 'group-data-controller'
      }
    },
    expect: {
      status: 200,
      partial: {
        path: '/SASjsApi/drive/rename',
        setting: 'Grant',
        group: 'group-data-controller'
      }
    }
  },
  {
    id: 'create-permission-invalid-principal-type',
    route: 'POST /SASjsApi/permission',
    description: 'refuses a principal type that is neither a user nor a group',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      body: {
        path: '/SASjsApi/drive/deploy',
        type: 'Route',
        setting: 'Grant',
        principalType: 'role',
        principalId: 'anything'
      }
    },
    expect: {
      status: 400,
      error: 'Invalid principal type. Valid types are user or group.'
    }
  },
  {
    id: 'create-permission-admin-principal',
    route: 'POST /SASjsApi/permission',
    description: 'refuses a rule assigned to an administrator',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      body: {
        path: '/SASjsApi/drive/folder',
        type: 'Route',
        setting: 'Grant',
        principalType: 'user',
        principalId: ADMIN_UID
      }
    },
    expect: {
      status: 400,
      error: 'Can not add permission for admin user.'
    }
  },
  {
    id: 'create-permission-not-admin',
    route: 'POST /SASjsApi/permission',
    description: 'refuses a creation by a non-administrator',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: RESTRICTED,
      body: {
        path: '/SASjsApi/drive/folder',
        type: 'Route',
        setting: 'Grant',
        principalType: 'user',
        principalId: RESTRICTED_UID
      }
    },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'create-permission-missing-principal',
    route: 'POST /SASjsApi/permission',
    description: 'answers 404 for a principal that does not exist',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      body: {
        path: '/SASjsApi/drive/rename',
        type: 'Route',
        setting: 'Grant',
        principalType: 'group',
        principalId: 'group-none'
      }
    },
    expect: { status: 404, error: 'Group not found.' }
  },
  {
    id: 'create-permission-duplicate-group',
    route: 'POST /SASjsApi/permission',
    description: 'refuses a group rule that already exists',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      body: {
        path: '/SASjsApi/drive/file',
        type: 'Route',
        setting: 'Grant',
        principalType: 'group',
        principalId: 'group-data-controller'
      }
    },
    expect: {
      status: 409,
      error: 'Permission already exists with provided Path, Type and Group.'
    }
  },
  {
    id: 'create-permission-duplicate',
    route: 'POST /SASjsApi/permission',
    description: 'refuses a rule that already exists',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      body: {
        path: '/SASjsApi/code/execute',
        type: 'Route',
        setting: 'Deny',
        principalType: 'user',
        principalId: RESTRICTED_UID
      }
    },
    expect: {
      status: 409,
      error: 'Permission already exists with provided Path, Type and User.'
    }
  },

  {
    id: 'update-permission',
    route: 'PATCH /SASjsApi/permission/{uid}',
    description: 'flips a rule from Deny to Grant',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      params: { uid: 'rule-code' },
      body: { setting: 'Grant' }
    },
    expect: { status: 200, partial: { uid: 'rule-code', setting: 'Grant' } }
  },
  {
    id: 'update-permission-not-admin',
    route: 'PATCH /SASjsApi/permission/{uid}',
    description: 'refuses a change by a non-administrator',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: RESTRICTED,
      params: { uid: 'rule-code' },
      body: { setting: 'Grant' }
    },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'update-permission-missing',
    route: 'PATCH /SASjsApi/permission/{uid}',
    description: 'answers 404 for a rule that does not exist',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      params: { uid: 'rule-none' },
      body: { setting: 'Grant' }
    },
    expect: { status: 404, error: 'Permission not found.' }
  },

  {
    id: 'delete-permission',
    route: 'DELETE /SASjsApi/permission/{uid}',
    description: 'deletes a rule',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN, params: { uid: 'rule-code' } },
    expect: { status: 200, body: 'Permission Deleted!' }
  },
  {
    id: 'delete-permission-not-admin',
    route: 'DELETE /SASjsApi/permission/{uid}',
    description: 'refuses a deletion by a non-administrator',
    identity: ADMIN_SIGNED_IN,
    request: { token: RESTRICTED, params: { uid: 'rule-code' } },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'delete-permission-missing',
    route: 'DELETE /SASjsApi/permission/{uid}',
    description: 'answers 404 for a rule that does not exist',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN, params: { uid: 'rule-none' } },
    expect: { status: 404, error: 'Permission not found.' }
  },

  // --------------------------------------------------------------- clients
  {
    id: 'list-clients',
    route: 'GET /SASjsApi/client',
    description: 'lists the registered clients',
    identity: ADMIN_SIGNED_IN,
    request: { token: ADMIN },
    expect: {
      status: 200,
      body: [
        {
          clientId: 'web_app',
          clientSecret: 'web_app',
          accessTokenExpiration: 86400,
          refreshTokenExpiration: 2592000
        },
        {
          clientId: 'sasjs',
          clientSecret: 'sasjs',
          accessTokenExpiration: 3600,
          refreshTokenExpiration: 86400
        }
      ]
    }
  },
  {
    id: 'list-clients-not-admin',
    route: 'GET /SASjsApi/client',
    description: 'refuses the list to a caller who is not an administrator',
    identity: ADMIN_SIGNED_IN,
    request: { token: RESTRICTED },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'create-client',
    route: 'POST /SASjsApi/client',
    description: 'registers a client',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      body: {
        clientId: 'new_app',
        clientSecret: 'new_secret',
        accessTokenExpiration: 3600,
        refreshTokenExpiration: 86400
      }
    },
    expect: {
      status: 200,
      body: {
        clientId: 'new_app',
        clientSecret: 'new_secret',
        accessTokenExpiration: 3600,
        refreshTokenExpiration: 86400
      }
    }
  },
  {
    id: 'create-client-defaults',
    route: 'POST /SASjsApi/client',
    description: 'applies the schema defaults when the lifetimes are omitted',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      body: { clientId: 'default_app', clientSecret: 'default_secret' }
    },
    expect: {
      status: 200,
      body: {
        clientId: 'default_app',
        clientSecret: 'default_secret',
        accessTokenExpiration: 86400,
        refreshTokenExpiration: 2592000
      }
    }
  },
  {
    id: 'create-client-not-admin',
    route: 'POST /SASjsApi/client',
    description: 'refuses a registration by a non-administrator',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: RESTRICTED,
      body: {
        clientId: 'new_app',
        clientSecret: 'new_secret',
        accessTokenExpiration: 3600,
        refreshTokenExpiration: 86400
      }
    },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'create-client-duplicate',
    route: 'POST /SASjsApi/client',
    description:
      'refuses a client id that is registered, with the 403 the server sends',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: ADMIN,
      body: {
        clientId: 'web_app',
        clientSecret: 'other',
        accessTokenExpiration: 3600,
        refreshTokenExpiration: 86400
      }
    },
    expect: { status: 403, error: 'Error: Client ID already exists.' }
  },

  // -------------------------------------------------------------- passwords
  {
    id: 'update-password',
    route: 'PATCH /SASjsApi/auth/updatePassword',
    description: 'changes the caller’s own password',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: RESTRICTED,
      body: { currentPassword: 'user123', newPassword: 'changed123' }
    },
    expect: { status: 204 }
  },
  {
    id: 'update-password-missing-field',
    route: 'PATCH /SASjsApi/auth/updatePassword',
    description: 'refuses a body without the current password',
    identity: ADMIN_SIGNED_IN,
    request: { token: RESTRICTED, body: { newPassword: 'changed123' } },
    expect: { status: 400, error: '"currentPassword" is required' }
  },
  {
    id: 'update-password-unauthenticated',
    route: 'PATCH /SASjsApi/auth/updatePassword',
    description: 'refuses the change with no caller',
    identity: ADMIN_SIGNED_IN,
    request: {
      body: { currentPassword: 'user123', newPassword: 'changed123' }
    },
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'update-password-wrong-current',
    route: 'PATCH /SASjsApi/auth/updatePassword',
    description: 'refuses a change whose current password is wrong',
    identity: ADMIN_SIGNED_IN,
    request: {
      token: RESTRICTED,
      body: { currentPassword: 'wrong', newPassword: 'changed123' }
    },
    expect: { status: 403, error: 'Invalid current password!' }
  },
  {
    id: 'update-password-provider',
    route: 'PATCH /SASjsApi/auth/updatePassword',
    description: 'refuses a password change on a provider-managed account',
    identity: PROVIDER_MANAGED,
    request: {
      token: 'dir-access',
      body: { currentPassword: 'dir123', newPassword: 'changed123' }
    },
    expect: {
      status: 405,
      error:
        'Can not update password of user that is created by an external auth provider.'
    }
  }
]
