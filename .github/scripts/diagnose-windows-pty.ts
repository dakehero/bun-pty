import { Terminal } from "../../src/terminal";

const marker = "Hello from PowerShell";
const flags = ["-NoLogo", "-NoProfile", "-NonInteractive"];
const timeout = 10000;
const results: object[] = [];
const windowsPowerShell = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const core = process.env.DIAGNOSTIC_PWSH!;

console.log(JSON.stringify({ bun: Bun.version, arch: process.arch, core, windowsPowerShell }));

async function inspect(pid: number) {
  const command = `Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress; Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object Id,CPU,Responding,StartTime | ConvertTo-Json -Compress; (Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Threads | Select-Object Id,ThreadState,WaitReason | ConvertTo-Json -Compress`;
  const child = Bun.spawn([core, ...flags, "-Command", command], { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 5000);
  const output = await new Response(child.stdout).text();
  await child.exited;
  clearTimeout(timer);
  console.log("PROCESS", output);
}

async function runPty(name: string, file: string, args: string[], wait = timeout) {
  const start = Date.now();
  let output = "";
  let exitCode: number | undefined;
  let exited = false;
  console.log("START", JSON.stringify({ name, file, args }));
  const terminal = new Terminal(file, args);
  terminal.onData((data) => {
    output += data;
    console.log("DATA", name, Date.now() - start, JSON.stringify(data));
  });
  terminal.onExit((event) => {
    if (!event.signal) {
      exitCode = event.exitCode;
      exited = true;
    }
  });
  while (!exited && Date.now() - start < wait) await Bun.sleep(50);
  await Bun.sleep(200);
  const result = { name, elapsed: Date.now() - start, pid: terminal.pid, exited, exitCode, hasMarker: output.includes(marker), output };
  console.log("RESULT", JSON.stringify(result));
  results.push(result);
  if (!exited) await inspect(terminal.pid);
  terminal.kill();
  await Bun.sleep(200);
}

async function runPipe(name: string, file: string, args: string[]) {
  const start = Date.now();
  let timedOut = false;
  const child = Bun.spawn([file, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
  const [output, error, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  clearTimeout(timer);
  const result = { name, elapsed: Date.now() - start, timedOut, exitCode, hasMarker: output.includes(marker), output, error };
  console.log("RESULT", JSON.stringify(result));
  results.push(result);
}

const environment = `[Console]::WriteLine('PSHOME=' + $PSHOME); [Console]::WriteLine('PSModulePath=' + $env:PSModulePath); [Console]::WriteLine('USERPROFILE=' + $env:USERPROFILE); [Console]::WriteLine('ConsoleWindow=' + $Host.UI.RawUI.WindowSize); [Console]::WriteLine('ConsoleBuffer=' + $Host.UI.RawUI.BufferSize)`;
await runPty("legacy-pty-environment", windowsPowerShell, [...flags, "-Command", environment]);
await runPipe("legacy-pipe-environment", windowsPowerShell, [...flags, "-Command", environment]);
await runPty("legacy-progress-silent", windowsPowerShell, [...flags, "-Command", `$ProgressPreference = 'SilentlyContinue'; Write-Output '${marker}'`]);
await runPty("legacy-qualified", windowsPowerShell, [...flags, "-Command", `Microsoft.PowerShell.Utility\\Write-Output '${marker}'`]);
await runPty("legacy-clean-modulepath", windowsPowerShell, [...flags, "-Command", `$env:PSModulePath = $PSHOME + '\\Modules'; Write-Output '${marker}'`]);
await runPty("legacy-import-utility", windowsPowerShell, [...flags, "-Command", `[Console]::WriteLine('BEFORE_IMPORT'); Import-Module Microsoft.PowerShell.Utility; [Console]::WriteLine('AFTER_IMPORT'); Write-Output '${marker}'`]);
await runPty("legacy-noenumerate", windowsPowerShell, [...flags, "-Command", `Write-Output -NoEnumerate '${marker}'`]);
await runPty("legacy-command-discovery", windowsPowerShell, [...flags, "-Command", `[Console]::WriteLine('BEFORE_DISCOVERY'); $command = Get-Command Write-Output; [Console]::WriteLine('AFTER_DISCOVERY'); [Console]::WriteLine($command.ModuleName); Write-Output '${marker}'`]);
await Bun.write("diagnostic-results.json", JSON.stringify(results, null, 2));
