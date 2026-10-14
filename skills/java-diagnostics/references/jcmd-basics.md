# jps and jcmd basics (Tier 1)

```bash
jps -lv                      # list JVMs with main class and JVM args
jcmd                         # same list via the attach API
jcmd <pid> help              # commands supported by that JVM
jcmd <pid> VM.version
jcmd <pid> VM.flags          # effective JVM flags
jcmd <pid> VM.system_properties
jcmd <pid> VM.uptime
jcmd <pid> VM.command_line
```

- Run as the same OS user as the target JVM, on the same host (or inside the same container). Different users/containers fail with "Unable to open socket file" or "process not found".
- `jcmd` is preferred over `jstack`/`jmap`/`jinfo`, which are older single-purpose tools.
- `-XX:+DisableAttachMechanism` blocks attach; `-XX:+StartAttachListener` forces the listener to start.
- Tools must match (or be newer than) the target JDK major version when possible.

## Crash or hang

- A crash writes `hs_err_pid<pid>.log` (path set by `-XX:ErrorFile`). Read the "Problematic frame" and thread sections first.
- `jhsdb` (Tier 3) attaches to a hung process or core file: `jhsdb jstack --pid <pid>` or `jhsdb jstack --exe <java> --core <core>`. It suspends the process while attached and requires matching JDK; core files contain heap data, so treat them like heap dumps.
