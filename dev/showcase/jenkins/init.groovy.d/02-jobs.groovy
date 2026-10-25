import com.cloudbees.hudson.plugins.folder.Folder
import java.nio.charset.StandardCharsets
import jenkins.branch.BranchSource
import jenkins.model.Jenkins
import jenkins.plugins.git.GitSCMSource
import jenkins.plugins.git.traits.BranchDiscoveryTrait
import org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject

def jenkins = Jenkins.get()

def folder = { String name, String description ->
    def item = jenkins.getItem(name)
    if (item == null) {
        item = jenkins.createProject(Folder, name)
        item.description = description
        item.save()
    }
    item
}

def pipeline = { parent, String name, String description, String script ->
    if (parent.getItem(name) != null) {
        return
    }
    def xml = """<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>${description}</description>
  <keepDependencies>false</keepDependencies>
  <properties/>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition" plugin="workflow-cps">
    <script><![CDATA[${script}]]></script>
    <sandbox>true</sandbox>
  </definition>
  <triggers/>
  <disabled>false</disabled>
</flow-definition>
"""
    def stream = new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8))
    try {
        parent.createProjectFromXML(name, stream)
    } finally {
        stream.close()
    }
}

if (jenkins.getItem("storefront") == null) {
    def project = jenkins.createProject(WorkflowMultiBranchProject, "storefront")
    project.description = "Cart, checkout, catalog, and shipping service for the Acme storefront."
    def source = new GitSCMSource("https://git.acme.dev/acme/storefront.git")
    source.id = "storefront-git"
    source.traits = [new BranchDiscoveryTrait()]
    project.sourcesList.add(new BranchSource(source))
    project.save()
}

def platform = folder("platform", "Shared deployment, migration, and end-to-end jobs.")
def mobile = folder("mobile", "Native app release pipelines.")

pipeline(platform, "deploy-staging", "Deploy a tagged service build to the staging cluster.", '''pipeline {
    agent { label 'linux' }
    parameters {
        choice(name: 'SERVICE', choices: ['storefront', 'checkout-api', 'search-indexer'], description: 'Service to deploy')
        string(name: 'VERSION', defaultValue: '2.14.0', description: 'Release version or image tag')
        booleanParam(name: 'RUN_SMOKE_TESTS', defaultValue: true, description: 'Run smoke tests after rollout')
        choice(name: 'REGION', choices: ['us-east-1', 'us-west-2', 'eu-central-1'], description: 'Target region')
    }
    options { timestamps() }
    stages {
        stage('Preflight') {
            steps {
                echo "Checking ${params.SERVICE}:${params.VERSION} in ${params.REGION}"
                sleep 2
            }
        }
        stage('Roll out') {
            steps {
                echo "kubectl rollout status deployment/${params.SERVICE} --namespace staging"
                sleep 4
            }
        }
        stage('Smoke tests') {
            when { expression { params.RUN_SMOKE_TESTS } }
            steps {
                echo 'GET /healthz 200 (41 ms)'
                sleep 2
            }
        }
    }
}''')

pipeline(platform, "nightly-e2e", "Browser end-to-end suites against staging.", '''pipeline {
    agent { label 'e2e' }
    parameters {
        string(name: 'SUITE_SECONDS', defaultValue: '20', description: 'Simulated suite duration')
    }
    options { timestamps() }
    stages {
        stage('Provision') {
            steps {
                echo 'Starting browsers on linux-agent-01'
                sleep 3
            }
        }
        stage('Suites') {
            parallel {
                stage('Chrome') { steps { sleep time: params.SUITE_SECONDS as Integer, unit: 'SECONDS' } }
                stage('Firefox') { steps { sleep time: (params.SUITE_SECONDS as Integer) + 4, unit: 'SECONDS' } }
                stage('WebKit') {
                    steps {
                        sleep time: (params.SUITE_SECONDS as Integer) + 2, unit: 'SECONDS'
                        unstable('3 specs passed only after a retry')
                    }
                }
            }
        }
        stage('Report') {
            steps { echo 'Published 214 specs to the dashboard' }
        }
    }
}''')

pipeline(platform, "db-migrate", "Plan and apply schema migrations with an approval gate.", '''pipeline {
    agent { label 'linux' }
    options { timestamps() }
    stages {
        stage('Plan') {
            steps {
                echo '3 pending migrations: 0042_discount_codes, 0043_code_expiry, 0044_refund_ledger'
                sleep 2
            }
        }
        stage('Approve') {
            steps {
                input message: 'Apply 3 migrations to staging?', ok: 'Apply', submitter: 'release-managers'
            }
        }
        stage('Apply') {
            steps { echo 'Applied 3 migrations' }
        }
    }
}''')

pipeline(mobile, "android-release", "Build and sign the Android release bundle.", '''pipeline {
    agent { label 'linux' }
    options { timestamps() }
    stages {
        stage('Assemble') {
            steps {
                sh 'mkdir -p build && head -c 2048 /dev/urandom > build/app-release.aab && echo "versionName=2.14.0" > build/output-metadata.txt'
                sleep 3
            }
        }
        stage('Sign') {
            steps { sleep 2 }
        }
    }
    post {
        success { archiveArtifacts artifacts: 'build/*', fingerprint: true }
    }
}''')

pipeline(mobile, "ios-release", "Archive and upload the iOS build. Runs on the macOS build host.", '''pipeline {
    agent { label 'macos' }
    stages {
        stage('Archive') {
            steps { sh 'xcodebuild -scheme Storefront archive' }
        }
    }
}''')

pipeline(jenkins, "docs-site", "Build and publish the developer documentation site.", '''pipeline {
    agent { label 'linux' }
    options { timestamps() }
    stages {
        stage('Build') { steps { sleep 3 } }
        stage('Publish') { steps { echo 'Published docs.acme.dev' } }
    }
}''')

jenkins.save()
