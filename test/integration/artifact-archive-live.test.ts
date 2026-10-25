/// <reference types="node" />
/// <reference types="mocha" />
import * as assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import * as vscode from "vscode";

async function until(check: () => Promise<boolean>, message: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(message);
}

/** Read the small, non-ZIP64 fixture archive without depending on a system unzip command. */
function archiveEntries(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "Jenkins must return a ZIP archive");
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    const localOffset = zip.readUInt32LE(offset + 42);
    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50);
    const dataOffset =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const compressed = zip.subarray(dataOffset, dataOffset + size);
    assert.ok(method === 0 || method === 8, "Unexpected ZIP compression method");
    entries.set(name, method === 8 ? inflateRawSync(compressed) : compressed);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Opt-in checks create and remove only uniquely named jobs on a loopback Jenkins fixture. */
describe("local Jenkins artifact archive", () => {
  (process.env.JENKINS_ARTIFACT_ARCHIVE_LIVE ? it : it.skip)(
    "downloads complete archives, supports running builds, and preserves files on failure",
    async function () {
      this.timeout(120_000);
      const extension = vscode.extensions.getExtension("airizom.jenkins-workbench");
      assert.ok(extension);
      const load = (path: string) =>
        import(vscode.Uri.joinPath(extension.extensionUri, "out-test", "host", path).fsPath);
      const [
        { JenkinsClient },
        { JenkinsDataService },
        { ArtifactStorageService },
        { createFileArtifactFilesystem }
      ] = await Promise.all([
        load("jenkins/JenkinsClient.js"),
        load("jenkins/JenkinsDataService.js"),
        load("services/ArtifactStorageService.js"),
        load("services/ArtifactFilesystem.js")
      ]);
      const url = process.env.JENKINS_ARTIFACT_ARCHIVE_URL ?? "http://127.0.0.1:8080/";
      assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname));
      const username = process.env.JENKINS_ARTIFACT_ARCHIVE_USER ?? "admin";
      const token =
        process.env.JENKINS_ARTIFACT_ARCHIVE_TOKEN ?? "11decafbaddecafbaddecafbaddecafbad";
      const client = new JenkinsClient({ baseUrl: url, username, token, requestTimeoutMs: 15_000 });
      const data = new JenkinsDataService(
        { getClient: async () => client, getAuthSignature: async () => "archive-live-fixture" },
        {
          cacheTtlMs: 1000,
          buildParameterRequestPreparer: {
            prepareBuildParameters: async () => ({ hasParameters: false })
          }
        }
      );
      const environment = { environmentId: "artifact-archive-live", scope: "workspace", url };
      const filesystem = createFileArtifactFilesystem();
      const storage = new ArtifactStorageService(data, filesystem);
      const workspaceRoot = await mkdtemp(join(tmpdir(), "jenkins-archive-live-"));
      const prefix = `workbench-archive-validation-${Date.now()}`;
      const ownedJobs: string[] = [];
      const runningBuilds = new Set<string>();
      const createJob = async (name: string, script: string): Promise<string> => {
        const target = new URL("createItem", url);
        target.searchParams.set("name", name);
        const response = await fetch(target, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`,
            "Content-Type": "application/xml"
          },
          body: `<flow-definition plugin="workflow-job"><definition class="org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition" plugin="workflow-cps"><script><![CDATA[${script}]]></script><sandbox>true</sandbox></definition><disabled>false</disabled></flow-definition>`
        });
        assert.ok(response.ok, `Creating isolated fixture job failed: ${response.status}`);
        await response.arrayBuffer();
        const jobUrl = new URL(`job/${name}/`, url).href;
        ownedJobs.push(jobUrl);
        return jobUrl;
      };
      const startBuild = async (jobUrl: string): Promise<string> => {
        const result = await client.triggerBuild(jobUrl, { mode: "build" });
        assert.ok(result.queueLocation);
        const queueId = Number(new URL(result.queueLocation).pathname.match(/\/item\/(\d+)/)?.[1]);
        assert.ok(queueId > 0);
        let buildUrl: string | undefined;
        await until(async () => {
          buildUrl = (await client.getQueueItem(queueId)).executable?.url;
          return Boolean(buildUrl);
        }, "Fixture build did not start");
        assert.ok(buildUrl);
        runningBuilds.add(buildUrl);
        return buildUrl;
      };

      try {
        const jobUrl = await createJob(
          prefix,
          `node {
            for (int i = 1; i <= 25; i++) {
              writeFile file: "bundle/nested/file-" + i + ".txt", text: "artifact " + i + "\\n"
            }
            sh 'head -c 2097152 /dev/urandom > bundle/payload.bin'
            archiveArtifacts artifacts: 'bundle/**'
            sleep time: 20, unit: 'SECONDS'
          }`
        );
        const buildUrl = await startBuild(jobUrl);
        await until(
          async () => (await client.getBuildArtifacts(buildUrl)).length === 26,
          "Fixture did not archive all 26 files"
        );
        const details = await client.getBuildDetails(buildUrl);
        assert.equal(details.building, true);
        const request = {
          environment,
          buildUrl,
          buildNumber: details.number,
          jobNameHint: prefix,
          workspaceRoot,
          downloadRoot: "artifacts"
        };
        const running = await storage.downloadAllArtifacts(request);
        assert.equal(basename(running.targetPath), `${details.number}.zip`);
        const entries = archiveEntries(await readFile(running.targetPath));
        const files = [...entries.entries()].filter(([name]) => !name.endsWith("/"));
        assert.equal(files.length, 26, "Archive must include artifacts beyond the panel's 20 rows");
        assert.equal(
          files.find(([name]) => name.endsWith("nested/file-25.txt"))?.[1].toString(),
          "artifact 25\n"
        );
        assert.equal(files.find(([name]) => name.endsWith("payload.bin"))?.[1].byteLength, 2097152);

        const single = await storage.downloadArtifact({
          ...request,
          relativePath: "bundle/nested/file-1.txt"
        });
        assert.equal(
          single.targetPath,
          join(dirname(running.targetPath), String(details.number), "bundle/nested/file-1.txt")
        );

        const original = await readFile(running.targetPath);
        await assert.rejects(
          () => storage.downloadAllArtifacts({ ...request, maxBytes: 1024 }),
          /limit|exceed|bytes/i
        );
        assert.deepEqual(await readFile(running.targetPath), original);
        assert.ok(
          (await readdir(dirname(running.targetPath))).every((name) => !name.endsWith(".tmp"))
        );

        const controller = new AbortController();
        const cancellationStorage = new ArtifactStorageService(data, {
          ...filesystem,
          createWriteStream: (targetPath: string) => {
            const sink = filesystem.createWriteStream(targetPath);
            sink.once("pipe", (source: NodeJS.ReadableStream) => {
              source.once("data", () => controller.abort());
            });
            return sink;
          }
        });
        await assert.rejects(() =>
          cancellationStorage.downloadAllArtifacts({
            ...request,
            signal: controller.signal
          })
        );
        assert.equal(controller.signal.aborted, true);
        assert.deepEqual(await readFile(running.targetPath), original);
        assert.ok(
          (await readdir(dirname(running.targetPath))).every((name) => !name.endsWith(".tmp"))
        );

        await until(
          async () => !(await client.getBuildDetails(buildUrl)).building,
          "Fixture build did not finish"
        );
        runningBuilds.delete(buildUrl);
        assert.equal((await client.getBuildDetails(buildUrl)).result, "SUCCESS");
        await writeFile(running.targetPath, "old archive");
        const complete = await storage.downloadAllArtifacts({ ...request, maxBytes: 0 });
        assert.equal(archiveEntries(await readFile(complete.targetPath)).size, entries.size);

        const emptyJobUrl = await createJob(`${prefix}-empty`, "echo 'No archived artifacts'");
        const emptyBuildUrl = await startBuild(emptyJobUrl);
        await until(
          async () => !(await client.getBuildDetails(emptyBuildUrl)).building,
          "Empty fixture build did not finish"
        );
        runningBuilds.delete(emptyBuildUrl);
        const emptyWorkspace = join(workspaceRoot, "empty");
        await assert.rejects(() =>
          storage.downloadAllArtifacts({
            ...request,
            buildUrl: emptyBuildUrl,
            workspaceRoot: emptyWorkspace
          })
        );
        await assert.rejects(() => readdir(emptyWorkspace), { code: "ENOENT" });
      } finally {
        for (const buildUrl of runningBuilds) {
          try {
            await client.stopBuild(buildUrl);
          } catch {
            /* Already finished. */
          }
        }
        for (const jobUrl of ownedJobs.reverse()) {
          await client.deleteJob(jobUrl);
        }
        await rm(workspaceRoot, { recursive: true, force: true });
      }
    }
  );
});
