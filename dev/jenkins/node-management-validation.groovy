import hudson.model.Node
import hudson.slaves.DumbSlave
import hudson.slaves.JNLPLauncher
import hudson.slaves.RetentionStrategy
import jenkins.model.Jenkins
import org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition
import org.jenkinsci.plugins.workflow.job.WorkflowJob

// Run in the local fixture's Script Console. Existing nodes/jobs are never changed.
// Connect the inbound agent from its Jenkins instructions page, then run the job.
def jenkins = Jenkins.get()
def nodeName = 'Workbench Node Management Agent'
def jobName = 'Workbench Node Management Busy'
def nodeRoot = '/tmp/workbench-node-management-agent'

if (jenkins.getNode(nodeName) == null) {
    def node = new DumbSlave(nodeName, nodeRoot, new JNLPLauncher())
    node.nodeDescription = 'Local Jenkins Workbench node management validation fixture.'
    node.numExecutors = 1
    node.mode = Node.Mode.EXCLUSIVE
    node.labelString = 'workbench-node-management'
    node.retentionStrategy = new RetentionStrategy.Always()
    jenkins.addNode(node)
    println("Created permanent inbound agent: ${nodeName}")
} else {
    println("Keeping existing node unchanged: ${nodeName}")
}

if (jenkins.getItem(jobName) == null) {
    def job = jenkins.createProject(WorkflowJob, jobName)
    job.description = 'Local node management fixture: keeps one agent executor busy for a minute.'
    job.definition = new CpsFlowDefinition('''node('Workbench Node Management Agent') {
    echo 'Node management validation: executor is busy'
    sleep time: 60, unit: 'SECONDS'
}''', true)
    job.save()
    println("Created job: ${jobName}")
} else {
    println("Keeping existing job unchanged: ${jobName}")
}

println('Connect the agent using its Jenkins connection instructions, then start the busy job.')
println('Verify that deleting a busy node is blocked, and that disconnect requests are explicit.')
println('After the build finishes, verify label editing and idle-node deletion.')
