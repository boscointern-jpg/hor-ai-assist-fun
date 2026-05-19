// Set up environment variables for tests
// This file should be imported before the main module in tests
// Mock config format matches runtime-config-local.yml structure
export const mockConfigVars = {
  "values": {
    "DB_HOST": "database.host.com",
    "DB_PORT": "1234",
    "DB_NAME": "dev_database",
    "SHORT_SHA": "abc123f",
    "NO_AUTH": "false"
  },
  "secrets": {
    "DB_USER": "db_user",
    "DB_PWD": "password123"
  }
}

export const mockEnvVars = {
  SHORT_SHA: 'abc123f',
  DB_HOST: 'database.host.com',
  DB_PORT: '1234',
  DB_NAME: 'dev_database',
  DB_USER: 'db_user',
  DB_PWD: 'password123'
};

// Set environment variables
Object.entries(mockEnvVars).forEach(([key, value]) => {
  process.env[key] = value;
});

export const restoreEnvVars = (): void => {
  Object.keys(mockEnvVars).forEach(key => {
    delete process.env[key];
  });
};

export const mockAuthVars = {
  "authorized": true,
  "authInfo": {
    "id": 90210,
    "me": {
      "entityEmployeeId": 12843,
      "entityId": 90210,
      "entityLocationId": 43289
    },
    "value": "90210|blahblahencryptedkey",
    "expires": 99999999
  }
}

export const mockAdminAuthVars = {
  "authorized": true,
  "authInfo": {
    "adminId": 328,
    "id": 16094,
    "value": "90210|blahblahencryptedkey",
    "expires": 99999999
  }
}

export const mockBadAuthVars = {
  "authorized": true,
  "authInfo": {
    "id": 16094,
    "value": "90210|blahblahencryptedkey",
    "expires": 99999999
  }
}
