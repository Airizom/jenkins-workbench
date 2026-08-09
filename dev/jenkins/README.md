# Local Jenkins test fixture

This fixture runs the official Jenkins LTS image on Java 21 and installs the plugins used by Jenkins Workbench. It is for local development only: ports bind to `127.0.0.1`, the setup wizard is disabled, and the default credentials are intentionally simple.

## Start

From the repository root:

```bash
docker compose -f dev/jenkins/compose.yaml up --detach --build --wait
```

Open <http://localhost:8080> and sign in with:

- Username: `admin`
- Password: `jenkins-workbench`

In the extension, add a Basic-auth environment using:

- URL: `http://127.0.0.1:8080`
- Username: `admin`
- API token: `11decafbaddecafbaddecafbaddecafbad`

The API token intentionally has a fixed development-only value so Jenkins POST actions work without a browser session cookie.

To use different credentials or ports, provide Compose variables when starting the service:

```bash
JENKINS_ADMIN_ID=tester \
JENKINS_ADMIN_PASSWORD='local-password' \
JENKINS_API_TOKEN='111234567890abcdef1234567890abcdef' \
JENKINS_HTTP_PORT=8081 \
docker compose -f dev/jenkins/compose.yaml up --detach --build --wait
```

The seeded jobs cover successful, failed, unstable, and not-built results; Pipeline stages; pending inputs; long-running and queued builds; artifacts; JUnit results; folders; parameters; and classic workspace browsing. Run `Workbench - Success` twice to populate Build Compare. Trigger `Workbench - Slow Queue` twice to leave its second run queued.

## Operate

```bash
# Follow Jenkins logs
docker compose -f dev/jenkins/compose.yaml logs --follow jenkins

# Stop Jenkins but preserve jobs and build history
docker compose -f dev/jenkins/compose.yaml down

# Delete the local Jenkins home and return to a clean fixture
docker compose -f dev/jenkins/compose.yaml down --volumes
```

An API token must use Jenkins' 34-character format: `11` followed by 32 hexadecimal characters. Changing credentials does not update an existing user or token in a persisted Jenkins home. Reset the volume if you need to recreate them with different values.
