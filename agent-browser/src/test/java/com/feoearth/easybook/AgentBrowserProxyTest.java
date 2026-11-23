package com.feoearth.easybook;

import org.junit.Test;
import java.net.InetAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

public class AgentBrowserProxyTest {
    @Test public void onlyPublicHttpsNamesCanBeNavigated() {
        assertEquals("docs.example.org", AgentBrowserProxy.publicUrl("https://docs.example.org/a?q=b#section").getHost());
        for (String value : new String[]{"http://example.org", "https://127.0.0.1", "https://[::1]", "https://router.lan",
            "https://example.org:444", "https://me@example.org", "https://appassets.androidplatform.net", "file:///data/local"}) {
            assertThrows(value, RuntimeException.class, () -> AgentBrowserProxy.publicUrl(value));
        }
    }

    @Test public void reservedAndTransitionNetworkAddressesAreDenied() throws Exception {
        for (String value : new String[]{"127.0.0.1", "10.1.2.3", "100.64.0.1", "169.254.169.254", "192.168.1.1",
            "198.19.1.2", "::1", "::ffff:192.168.1.1", "fd00::1", "64:ff9b::a01:203", "2002:7f00:1::", "2001:db8::1"}) {
            assertFalse(value, AgentBrowserProxy.publicDestination(InetAddress.getByName(value)));
        }
        assertTrue(AgentBrowserProxy.publicDestination(InetAddress.getByName("8.8.8.8")));
        assertTrue(AgentBrowserProxy.publicDestination(InetAddress.getByName("2606:4700:4700::1111")));
    }

    @Test public void loopbackProbeIsAcknowledgedAndPrivateRequestsAreRejected() throws Exception {
        try (AgentBrowserProxy proxy = new AgentBrowserProxy()) {
            proxy.setActive(true);
            AtomicBoolean observed = new AtomicBoolean();
            proxy.expectProbe("fixture.browser-proxy.invalid", () -> observed.set(true));
            assertTrue(request(proxy, "CONNECT fixture.browser-proxy.invalid:443 HTTP/1.1").contains("403 Forbidden"));
            assertTrue(observed.get());
            assertTrue(request(proxy, "CONNECT 127.0.0.1:443 HTTP/1.1").contains("403 Forbidden"));
            assertTrue(request(proxy, "GET https://example.org/ HTTP/1.1").contains("403 Forbidden"));
        }
    }

    private static String request(AgentBrowserProxy proxy, String line) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", proxy.port())) {
            socket.setSoTimeout(5000);
            socket.getOutputStream().write((line + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            return new String(socket.getInputStream().readAllBytes(), StandardCharsets.US_ASCII);
        }
    }
}
