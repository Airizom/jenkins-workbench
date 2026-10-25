import hudson.model.Action
import hudson.model.Cause
import hudson.model.CauseAction
import hudson.model.ParametersAction
import hudson.model.ParametersDefinitionProperty
import hudson.model.StringParameterDefinition
import hudson.model.StringParameterValue
import jenkins.model.Jenkins
import org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition
import org.jenkinsci.plugins.workflow.job.WorkflowJob

// Run once in the local Jenkins Script Console. Existing jobs are never modified or rebuilt.
def jenkins = Jenkins.get()
def replayName = 'Workbench Local Replay Validation'
def emptyName = 'Workbench Local Replay Empty'
def parameterValue = 'retained-parameter'
def script = '''node {
    writeFile file: 'helper.groovy', text: "echo 'loaded-script-preserved'; return this"
    load 'helper.groovy'
    echo "parameter=${params.GREETING}"
}'''

def createJob = { String name ->
    if (jenkins.getItem(name) != null) {
        println("Keeping existing job unchanged: ${name}")
        return null
    }
    def job = jenkins.createProject(WorkflowJob, name)
    job.description = 'Local Jenkins Workbench replay validation fixture.'
    job.definition = new CpsFlowDefinition(script, true)
    job.addProperty(new ParametersDefinitionProperty(
        new StringParameterDefinition('GREETING', parameterValue, 'Value preserved by replay')
    ))
    job.save()
    println("Created job: ${name}")
    return job
}

def replayJob = createJob(replayName)
createJob(emptyName)
if (replayJob != null) {
    def queued = replayJob.scheduleBuild2(0, [
        new CauseAction(new Cause.UserIdCause()),
        new ParametersAction(new StringParameterValue('GREETING', parameterValue))
    ] as Action[])
    if (queued == null) {
        throw new IllegalStateException("Unable to schedule seed build for ${replayName}")
    }
    println("Seed build queued for ${replayName}; wait for SUCCESS before running the live test.")
}
println("Leave ${emptyName} unbuilt to exercise the no-completed-build path.")
