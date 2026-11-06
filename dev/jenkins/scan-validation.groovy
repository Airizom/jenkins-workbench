import jenkins.branch.BranchProperty
import jenkins.branch.BranchSource
import jenkins.branch.DefaultBranchPropertyStrategy
import jenkins.branch.NoTriggerBranchProperty
import jenkins.model.Jenkins
import jenkins.plugins.git.GitSCMSource
import jenkins.plugins.git.traits.BranchDiscoveryTrait
import org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject

// Called by the opt-in integration test with a unique name and a temporary Git
// HTTP server. Uses ordinary plugin classes without changing Jenkins security.
def name = binding.getVariable('fixtureName')
def remote = binding.getVariable('fixtureRemote')
assert name.startsWith('workbench-scan-validation-')
def jenkins = Jenkins.get()
assert jenkins.getItem(name) == null : 'Refusing to replace an existing item'
def project = jenkins.createProject(WorkflowMultiBranchProject.class, name)
def gitSource = new GitSCMSource(remote)
gitSource.traits = [new BranchDiscoveryTrait()]
def source = new BranchSource(gitSource)
source.strategy = new DefaultBranchPropertyStrategy([new NoTriggerBranchProperty()] as BranchProperty[])
project.sourcesList.add(source)
println("SCAN_FIXTURE_READY:${name}")
