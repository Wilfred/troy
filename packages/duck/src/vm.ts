import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const OUTPUT_START_MARKER = "===DUCK_VM_OUTPUT_START===";
const OUTPUT_END_MARKER = "===DUCK_VM_OUTPUT_END===";
const VM_TIMEOUT_MS = 120_000;

export const VM_TOOL = {
  type: "function" as const,
  function: {
    name: "run_in_vm",
    description:
      "Run a shell command in a disposable QEMU virtual machine. " +
      "The VM boots a Linux cloud image, executes the command, and is " +
      "destroyed immediately after. Use this for commands that need " +
      "isolation or a full Linux environment.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string" as const,
          description: "The shell command to execute inside the VM",
        },
      },
      required: ["command"],
    },
  },
};

export async function runInVm(command: string): Promise<string> {
  const baseImage = process.env.QEMU_BASE_IMAGE;
  if (!baseImage) {
    return (
      "Error: QEMU_BASE_IMAGE environment variable is not set. " +
      "Point it at a cloud-init-compatible qcow2 image (e.g. Alpine, Ubuntu)."
    );
  }

  const workDir = await mkdtemp(join(tmpdir(), "duck-vm-"));

  try {
    const overlayPath = join(workDir, "overlay.qcow2");
    const seedPath = join(workDir, "seed.iso");
    const userDataPath = join(workDir, "user-data");
    const metaDataPath = join(workDir, "meta-data");

    await execFileAsync("qemu-img", [
      "create",
      "-f",
      "qcow2",
      "-b",
      baseImage,
      "-F",
      "qcow2",
      overlayPath,
    ]);

    const userData = [
      "#cloud-config",
      "runcmd:",
      `  - ['sh', '-c', 'echo ${OUTPUT_START_MARKER}']`,
      `  - ['sh', '-c', ${JSON.stringify(command + " 2>&1 || true")}]`,
      `  - ['sh', '-c', 'echo ${OUTPUT_END_MARKER}']`,
      "  - ['sh', '-c', 'poweroff']",
    ].join("\n");

    await writeFile(userDataPath, userData);
    await writeFile(
      metaDataPath,
      "instance-id: duck-vm\nlocal-hostname: duck-vm\n",
    );

    await execFileAsync("genisoimage", [
      "-output",
      seedPath,
      "-volid",
      "cidata",
      "-joliet",
      "-rock",
      userDataPath,
      metaDataPath,
    ]);

    const { stdout } = await execFileAsync(
      "qemu-system-x86_64",
      [
        "-machine",
        "accel=kvm:tcg",
        "-m",
        "512",
        "-nographic",
        "-drive",
        `file=${overlayPath},format=qcow2`,
        "-drive",
        `file=${seedPath},format=raw`,
        "-net",
        "none",
      ],
      { timeout: VM_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
    );

    const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
    const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

    if (startIdx === -1 || endIdx === -1) {
      return (
        "Error: could not capture command output from VM. " +
        "The VM may have timed out or failed to boot."
      );
    }

    return stdout.slice(startIdx + OUTPUT_START_MARKER.length, endIdx).trim();
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
