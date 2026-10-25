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

## Local Jenkinsfile replay validation

Open the local Jenkins [Script Console](http://127.0.0.1:8080/script), paste the contents of [local-replay-validation.groovy](local-replay-validation.groovy), and run it. The script creates `Workbench Local Replay Validation` and `Workbench Local Replay Empty` only when absent; it does not change existing jobs or permissions. Wait for the validation job's seed build to finish successfully. It records a loaded Groovy script and the `GREETING=retained-parameter` parameter for the replay test. Leave the Empty job unbuilt.

Compile the extension, then run the live replay test in an Extension Development Host:

```bash
npm run compile
JENKINS_REPLAY_LIVE=1 \
JENKINS_REPLAY_URL='http://127.0.0.1:8080/' \
JENKINS_REPLAY_USER=admin \
JENKINS_REPLAY_TOKEN='11decafbaddecafbaddecafbaddecafbad' \
JENKINS_REPLAY_JOB_URL='http://127.0.0.1:8080/job/Workbench%20Local%20Replay%20Validation/' \
JENKINS_REPLAY_EMPTY_JOB_URL='http://127.0.0.1:8080/job/Workbench%20Local%20Replay%20Empty/' \
npm run test:integration:ci
```

Use a valid API token for the local instance if its persisted credentials differ. `JENKINS_REPLAY_EMPTY_JOB_URL` is optional; supplying it also checks that a job without completed builds never receives a replay request. The test starts a real replay build and verifies that unsaved editor text runs while the original parameters and loaded script remain intact.

To check denied replay access, also supply `JENKINS_REPLAY_READER_USER` and `JENKINS_REPLAY_READER_TOKEN` for your own fixture account that can read the job/build but cannot replay it. The fixture script does not create accounts or change authorization. Both reader variables are optional; omit them to skip this permission check.
