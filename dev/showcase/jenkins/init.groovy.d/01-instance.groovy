import hudson.model.Node
import hudson.model.User
import hudson.security.AuthorizationStrategy
import hudson.security.SecurityRealm
import hudson.slaves.DumbSlave
import hudson.slaves.JNLPLauncher
import hudson.slaves.RetentionStrategy
import jenkins.model.Jenkins
import jenkins.model.JenkinsLocationConfiguration

// Loopback-only marketing fixture: anonymous access keeps VS Code setup free of secrets.
def jenkins = Jenkins.get()
jenkins.securityRealm = SecurityRealm.NO_AUTHENTICATION
jenkins.authorizationStrategy = AuthorizationStrategy.UNSECURED
jenkins.numExecutors = 2
jenkins.labelString = "node linux"
jenkins.mode = Node.Mode.NORMAL

def location = JenkinsLocationConfiguration.get()
location.url = System.getenv("SHOWCASE_PUBLIC_URL") ?: "http://ci.acme.localhost:8091/"
location.save()

// Commit authors resolve to these ids, so changelogs show full names.
[
    "marcus.chen": "Marcus Chen",
    "priya.shah": "Priya Shah",
    "sam.lee": "Sam Lee",
    "jane.doe": "Jane Doe"
].each { id, fullName ->
    def user = User.getById(id, true)
    user.fullName = fullName
    user.save()
}

def agents = [
    [name: "linux-agent-01", labels: "linux docker e2e", executors: 2, description: "Ephemeral Docker agent for integration suites"],
    [name: "macos-arm64-01", labels: "macos xcode", executors: 1, description: "Mac mini build host for iOS releases"]
]
agents.each { spec ->
    if (jenkins.getNode(spec.name) == null) {
        def agent = new DumbSlave(spec.name, "/home/jenkins/agent", new JNLPLauncher())
        agent.numExecutors = spec.executors
        agent.labelString = spec.labels
        agent.nodeDescription = spec.description
        agent.retentionStrategy = RetentionStrategy.Always.INSTANCE
        jenkins.addNode(agent)
    }
}
jenkins.save()
