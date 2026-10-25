import com.cloudbees.hudson.plugins.folder.Folder
import hudson.model.FreeStyleProject
import hudson.tasks.BuildTrigger
import jenkins.model.Jenkins
import org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition
import org.jenkinsci.plugins.workflow.job.WorkflowJob

// Local development fixture only. Existing jobs and builds are left intact.
def jenkins = Jenkins.get()
def root = jenkins.getItem('Workbench Relationships Validation') ?:
    jenkins.createProject(Folder, 'Workbench Relationships Validation')
def nested = root.getItem('Nested') ?: root.createProject(Folder, 'Nested')
def pipeline = { parent, name, script ->
    def job = parent.getItem(name)
    if (job == null) {
        job = parent.createProject(WorkflowJob, name)
        job.definition = new CpsFlowDefinition(script, true)
        job.save()
    }
    job
}
pipeline(root, 'Child', "echo 'Relationship fixture child'")
pipeline(nested, 'Other Child', "echo 'Relationship fixture nested child'")
def fanout = pipeline(root, 'Fanout', '''parallel(
    repeated: {
        build job: '/Workbench Relationships Validation/Child', wait: true
        build job: '/Workbench Relationships Validation/Child', wait: true
    },
    nested: { build job: '/Workbench Relationships Validation/Nested/Other Child', wait: true }
)''')
if (fanout.lastBuild == null) fanout.scheduleBuild2(0)

def classicChild = root.getItem('Classic Child') ?:
    root.createProject(FreeStyleProject, 'Classic Child')
def classicParent = root.getItem('Classic Parent')
if (classicParent == null) {
    classicParent = root.createProject(FreeStyleProject, 'Classic Parent')
    classicParent.publishersList.add(new BuildTrigger(classicChild.fullName, false))
    classicParent.save()
}
if (classicParent.lastBuild == null) classicParent.scheduleBuild2(0)
println('Relationship fixture ready: ' + root.url)
