# In-Process Runtime

Run the Copilot runtime inside your JVM instead of launching a separate Copilot CLI process.

> **Runnable example:** [recipe/InProcessRuntime.java](recipe/InProcessRuntime.java)
>
> ```bash
> # Linux x64 (glibc); choose the classifier for your platform below.
> jbang --deps com.github:copilot-sdk-java-runtime:1.0.21:linux-x64 recipe/InProcessRuntime.java
> ```

## Example scenario

By default, `CopilotClient` manages a child process and communicates over stdio or TCP.
Hosts that need to avoid a separate process for the SDK transport can load the native
Copilot runtime directly into the JVM instead. The runtime's tools can still launch
subprocesses; in-process transport is not a sandbox.

## Prerequisites

Use Java 17 or later and SDK 1.0.21. JDK 25 or later is recommended. In addition to the
SDK, Java needs JNA and a platform-specific native runtime artifact of the same SDK version:

```xml
<dependencies>
    <dependency>
        <groupId>com.github</groupId>
        <artifactId>copilot-sdk-java</artifactId>
        <version>1.0.21</version>
    </dependency>
    <dependency>
        <groupId>com.github</groupId>
        <artifactId>copilot-sdk-java-runtime</artifactId>
        <version>1.0.21</version>
        <classifier>linux-x64</classifier>
    </dependency>
    <dependency>
        <groupId>net.java.dev.jna</groupId>
        <artifactId>jna</artifactId>
        <version>5.19.1</version>
    </dependency>
</dependencies>
```

Choose `linux-x64` or `linux-arm64` for glibc Linux, `linuxmusl-x64` or
`linuxmusl-arm64` for musl Linux, `win32-x64` or `win32-arm64` for Windows, and
`darwin-x64` or `darwin-arm64` for macOS. JBang resolves the SDK and JNA from the
recipe's `//DEPS` directives; pass the native artifact using `--deps` as shown above.
For example, on Apple Silicon:

```bash
jbang --deps com.github:copilot-sdk-java-runtime:1.0.21:darwin-arm64 recipe/InProcessRuntime.java
```

## Using the in-process connection

```java
import com.github.copilot.AllowCopilotExperimental;
import com.github.copilot.CopilotClient;
import com.github.copilot.rpc.*;
import java.util.concurrent.TimeUnit;

@AllowCopilotExperimental
public class InProcessExample {
    public static void main(String[] args) throws Exception {
        var options = new CopilotClientOptions()
            .setConnection(RuntimeConnection.forInProcess());

        try (var client = new CopilotClient(options)) {
            client.start().get(30, TimeUnit.SECONDS);

            try (var session = client.createSession(new SessionConfig()
                    .setModel("auto")
                    .setOnPermissionRequest(PermissionHandler.APPROVE_ALL))
                    .get(30, TimeUnit.SECONDS)) {
                var response = session.sendAndWait(new MessageOptions()
                        .setPrompt("Hello from the in-process runtime!"))
                    .get(60, TimeUnit.SECONDS);
                System.out.println(response.getData().content());
            }
        }
    }
}
```

The connection API is experimental. `@AllowCopilotExperimental` opts the class in;
projects can instead pass `-Acopilot.experimental.allowed=true` to the SDK's
annotation processor. See the [official experimental API guidance](https://github.com/github/copilot-sdk/blob/main/java/README.md#using-experimental-apis).
Session events, tools, permissions, and hooks use the same Java APIs as the default transport.

## How it works

The SDK loads `runtime.node` through JNA and exchanges JSON-RPC messages over the
native C ABI rather than a child-process transport. The platform classifier JAR
provides the runtime library; the SDK extracts it to a versioned cache before loading it.

The recipe enables native access with `//JAVA_OPTIONS --enable-native-access=ALL-UNNAMED`.
For a regular Java application, pass `--enable-native-access=ALL-UNNAMED` to `java`
when JNA is on the classpath, or allow its module when using the module path.

You can also set `COPILOT_SDK_DEFAULT_CONNECTION=inprocess` before starting the
JVM to select this transport for a client with no explicit connection. Explicit
subprocess settings such as a CLI path, server URL, or TCP port take precedence
over that environment default. The native artifact and JNA are still required.

To check native startup, a local RPC round trip, and shutdown without making a model
request, add `--ping`:

```bash
jbang --deps com.github:copilot-sdk-java-runtime:1.0.21:linux-x64 recipe/InProcessRuntime.java --ping
```

## Limitations

- **Shared process state**: clients share the JVM's native runtime library, environment,
  and operating-system working directory.
- **Rejected process options**: do not set per-client `cwd`, environment, telemetry,
  or CLI arguments for this connection. Configure the host process before startup.
- **One native runtime per process**: do not try to load different native runtime
  builds into the same JVM. The library remains loaded after the client closes.
- **Platform dependencies**: the classifier must match the OS and architecture,
  and JNA must be on the classpath. Missing or mismatched libraries fail startup.
- **Permissions still matter**: the example uses `PermissionHandler.APPROVE_ALL`
  for brevity. Use an explicit, restrictive permission handler for untrusted requests.

## Best practices

1. **Test each deployment platform**: verify startup, model turns, and shutdown
   on every OS and architecture you support.
2. **Prefer the default transport** unless avoiding the SDK's child process is a requirement.
3. **Close resources**: use nested try-with-resources for the session and client.
   Closing the connection does not unload the native library.
4. **Configure process-wide values early**: set the environment and working directory
   before starting the JVM, rather than assuming per-client overrides work.
