import com.cloudbees.hudson.plugins.folder.Folder
import hudson.model.Item
import java.nio.charset.StandardCharsets
import jenkins.model.Jenkins

def jenkins = Jenkins.get()

def createFromXml = { parent, String name, String xml ->
    if (parent.getItem(name) != null) {
        return
    }

    def stream = new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8))
    try {
        parent.createProjectFromXML(name, stream)
        println("Created Jenkins Workbench test job: ${name}")
    } finally {
        stream.close()
    }
}

def pipelineXml = { String description, String script ->
    """<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <actions/>
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
}

createFromXml(jenkins, "Workbench - Success", pipelineXml(
    "Successful parameterized Declarative Pipeline with stages, JUnit results, and artifacts.",
    '''pipeline {
    agent any
    parameters {
        string(name: 'GREETING', defaultValue: 'Hello from Jenkins Workbench', description: 'Text written to the build artifact')
        booleanParam(name: 'RUN_TESTS', defaultValue: true, description: 'Create and publish a JUnit report')
        choice(name: 'TARGET', choices: ['development', 'staging', 'production'], description: 'Sample deployment target')
    }
    options {
        timestamps()
        preserveStashes(buildCount: 5)
    }
    stages {
        stage('Build') {
            steps {
                sh 'mkdir -p artifacts test-results && printf "%s\\n" "$GREETING" > artifacts/message.txt'
                stash name: 'workbench-output', includes: 'artifacts/**'
            }
        }
        stage('Test') {
            when { expression { params.RUN_TESTS } }
            steps {
                sh """cat > test-results/results.xml <<'XML'
<testsuite name="jenkins-workbench" tests="2" failures="0" errors="0" skipped="0" time="0.02">
  <testcase classname="WorkbenchFixture" name="loadsTree" time="0.01"/>
  <testcase classname="WorkbenchFixture" name="rendersBuildDetails" time="0.01"/>
</testsuite>
XML"""
                junit testResults: 'test-results/*.xml'
            }
        }
        stage('Deploy') {
            steps {
                echo "Simulated deployment to ${params.TARGET}"
            }
        }
    }
    post {
        always {
            archiveArtifacts artifacts: 'artifacts/**', fingerprint: true, allowEmptyArchive: true
        }
    }
}'''
))

createFromXml(jenkins, "Workbench - Failure", pipelineXml(
    "Declarative Pipeline with a deliberate failing stage for failure insights and restart-from-stage testing.",
    '''pipeline {
    agent any
    options {
        timestamps()
        preserveStashes(buildCount: 5)
    }
    stages {
        stage('Checkout') {
            steps {
                echo 'Preparing the failing fixture'
            }
        }
        stage('Test') {
            steps {
                sh 'echo "src/example.ts:12:4: error: deliberate Jenkins Workbench failure" && exit 1'
            }
        }
        stage('Package') {
            steps {
                echo 'This stage should be skipped'
            }
        }
    }
}'''
))

createFromXml(jenkins, "Workbench - Input", pipelineXml(
    "Pipeline that pauses for an approval so pending-input actions can be tested.",
    '''pipeline {
    agent any
    options { timestamps() }
    stages {
        stage('Prepare') {
            steps { echo 'Waiting for approval from Jenkins Workbench' }
        }
        stage('Approval') {
            steps {
                input message: 'Continue the Workbench test?', ok: 'Approve'
            }
        }
        stage('Finish') {
            steps { echo 'Input approved' }
        }
    }
}'''
))

createFromXml(jenkins, "Workbench - Slow Queue", pipelineXml(
    "Non-concurrent Pipeline that stays active long enough to test queue visibility, cancellation, and aborts.",
    '''pipeline {
    agent any
    options {
        disableConcurrentBuilds()
        timestamps()
    }
    parameters {
        string(name: 'SECONDS', defaultValue: '120', description: 'How long the simulated build should run')
    }
    stages {
        stage('Long running work') {
            steps {
                echo "Sleeping for ${params.SECONDS} seconds; trigger this job twice to create a queue item"
                sleep time: params.SECONDS as Integer, unit: 'SECONDS'
            }
        }
    }
}'''
))

createFromXml(jenkins, "Workbench - Unstable", pipelineXml(
    "Pipeline that completes with an UNSTABLE result.",
    '''pipeline {
    agent any
    stages {
        stage('Quality Gate') {
            steps {
                echo 'Marking this build unstable for extension testing'
                unstable('Deliberate quality-gate warning')
            }
        }
    }
}'''
))

createFromXml(jenkins, "Workbench - Not Built", pipelineXml(
    "Pipeline that completes with a NOT_BUILT result for task exit-code testing.",
    '''pipeline {
    agent any
    stages {
        stage('Skip') {
            steps {
                script {
                    currentBuild.result = 'NOT_BUILT'
                    echo 'Deliberately marked NOT_BUILT'
                }
            }
        }
    }
}'''
))

def freestyleXml = '''<?xml version='1.1' encoding='UTF-8'?>
<project>
  <actions/>
  <description>Classic job with a persistent workspace, nested files, parameters, JUnit output, and artifacts.</description>
  <keepDependencies>false</keepDependencies>
  <properties>
    <hudson.model.ParametersDefinitionProperty>
      <parameterDefinitions>
        <hudson.model.StringParameterDefinition>
          <name>MESSAGE</name>
          <description>Content written into the sample workspace file</description>
          <defaultValue>Hello from the classic Jenkins workspace</defaultValue>
          <trim>false</trim>
        </hudson.model.StringParameterDefinition>
      </parameterDefinitions>
    </hudson.model.ParametersDefinitionProperty>
  </properties>
  <scm class="hudson.scm.NullSCM"/>
  <canRoam>true</canRoam>
  <disabled>false</disabled>
  <blockBuildWhenDownstreamBuilding>false</blockBuildWhenDownstreamBuilding>
  <blockBuildWhenUpstreamBuilding>false</blockBuildWhenUpstreamBuilding>
  <triggers/>
  <concurrentBuild>false</concurrentBuild>
  <builders>
    <hudson.tasks.Shell>
      <command><![CDATA[set -eu
mkdir -p artifacts nested test-results
printf '%s\n' "$MESSAGE" > nested/workspace-preview.txt
printf '{"status":"ok","source":"jenkins-workbench"}\n' > artifacts/result.json
cat > test-results/results.xml <<'XML'
<testsuite name="freestyle-workbench" tests="1" failures="0" errors="0" skipped="0" time="0.01">
  <testcase classname="FreestyleFixture" name="createsWorkspace" time="0.01"/>
</testsuite>
XML
]]></command>
      <configuredLocalRules/>
    </hudson.tasks.Shell>
  </builders>
  <publishers>
    <hudson.tasks.junit.JUnitResultArchiver plugin="junit">
      <testResults>test-results/*.xml</testResults>
      <keepLongStdio>false</keepLongStdio>
      <healthScaleFactor>1.0</healthScaleFactor>
      <allowEmptyResults>false</allowEmptyResults>
      <skipPublishingChecks>false</skipPublishingChecks>
      <checksName/>
      <skipMarkingBuildUnstable>false</skipMarkingBuildUnstable>
      <skipOldReports>false</skipOldReports>
    </hudson.tasks.junit.JUnitResultArchiver>
    <hudson.tasks.ArtifactArchiver>
      <artifacts>artifacts/**</artifacts>
      <allowEmptyArchive>false</allowEmptyArchive>
      <onlyIfSuccessful>false</onlyIfSuccessful>
      <fingerprint>true</fingerprint>
      <defaultExcludes>true</defaultExcludes>
      <caseSensitive>true</caseSensitive>
      <followSymlinks>false</followSymlinks>
    </hudson.tasks.ArtifactArchiver>
  </publishers>
  <buildWrappers/>
</project>
'''

createFromXml(jenkins, "Workbench - Freestyle Workspace", freestyleXml)

def samplesFolder = jenkins.getItem("Workbench Samples")
if (samplesFolder == null) {
    samplesFolder = jenkins.createProject(Folder, "Workbench Samples")
    samplesFolder.description = "Folder fixture for Jenkins Workbench hierarchy and navigation testing."
    samplesFolder.save()
    println("Created Jenkins Workbench test folder: Workbench Samples")
}

createFromXml(samplesFolder, "Nested Pipeline", pipelineXml(
    "Small successful Pipeline nested inside a folder.",
    '''pipeline {
    agent any
    stages {
        stage('Nested') {
            steps { echo 'Hello from a nested Jenkins folder' }
        }
    }
}'''
))

jenkins.save()
