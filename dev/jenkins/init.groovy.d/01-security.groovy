import hudson.model.User
import hudson.security.FullControlOnceLoggedInAuthorizationStrategy
import hudson.security.HudsonPrivateSecurityRealm
import jenkins.model.Jenkins
import jenkins.security.ApiTokenProperty

def jenkins = Jenkins.get()
def adminId = System.getenv("JENKINS_ADMIN_ID") ?: "admin"
def adminPassword = System.getenv("JENKINS_ADMIN_PASSWORD") ?: "jenkins-workbench"
def apiToken = System.getenv("JENKINS_API_TOKEN") ?: "11decafbaddecafbaddecafbaddecafbad"

if (!(jenkins.securityRealm instanceof HudsonPrivateSecurityRealm)) {
    jenkins.securityRealm = new HudsonPrivateSecurityRealm(false)
}

if (User.getById(adminId, false) == null) {
    jenkins.securityRealm.createAccount(adminId, adminPassword)
}

def admin = User.getById(adminId, false)
def apiTokenProperty = admin.getProperty(ApiTokenProperty)
if (apiTokenProperty == null) {
    apiTokenProperty = new ApiTokenProperty()
    admin.addProperty(apiTokenProperty)
}

def workbenchTokenExists = apiTokenProperty.tokenStore.tokenListSortedByName.any {
    it.name == "jenkins-workbench"
}
if (!workbenchTokenExists) {
    apiTokenProperty.addFixedNewToken("jenkins-workbench", apiToken)
}

def authorization = new FullControlOnceLoggedInAuthorizationStrategy()
authorization.allowAnonymousRead = false
jenkins.authorizationStrategy = authorization

jenkins.numExecutors = 2
jenkins.labelString = "controller linux docker"
jenkins.save()

println("Jenkins Workbench test administrator and API token are ready: ${adminId}")
