package com.feoearth.easybook;

import org.junit.Test;
import java.net.InetAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
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

    @Test public void dualStackConnectionsTryTheOtherFamilyEarlyAndRejectMixedPrivateAnswers() throws Exception {
        InetAddress first = InetAddress.getByName("2606:4700:4700::1111");
        InetAddress second = InetAddress.getByName("2606:4700:4700::1001");
        InetAddress alternate = InetAddress.getByName("1.1.1.1");
        assertEquals(Arrays.asList(first, alternate, second), AgentBrowserProxy.connectionOrder(new InetAddress[]{first, second, alternate}));
        InetAddress privateAddress = InetAddress.getByName("10.1.2.3");
        assertThrows(java.io.IOException.class, () -> AgentBrowserProxy.connectionOrder(new InetAddress[]{first, privateAddress}));
    }

    private static String request(AgentBrowserProxy proxy, String line) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", proxy.port())) {
            socket.setSoTimeout(5000);
            socket.getOutputStream().write((line + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            return new String(socket.getInputStream().readAllBytes(), StandardCharsets.US_ASCII);
        }
    }

    @Test public void lastAddressReceivesTheRemainingConnectionBudget() {
        assertEquals(10000, AgentBrowserProxy.connectionTimeout(10000, 1));
        assertEquals(2500, AgentBrowserProxy.connectionTimeout(10000, 2));
        assertEquals(7500, AgentBrowserProxy.connectionTimeout(7500, 1));
        assertEquals(600, AgentBrowserProxy.connectionTimeout(600, 2));
    }

    @Test public void resolverFallbackRequiresConsentAndCannotConnectToPrivateAddresses() throws Exception {
        InetAddress synthetic = InetAddress.getByName("198.18.0.10");
        InetAddress local = InetAddress.getByName("10.0.0.1");
        AtomicInteger queries = new AtomicInteger();
        try (AgentBrowserProxy proxy = new AgentBrowserProxy(host -> new InetAddress[]{synthetic}, host -> {
            assertEquals("example.com", host);
            queries.incrementAndGet();
            return new InetAddress[]{local};
        })) {
            String request = "CONNECT example.com:443 HTTP/1.1";
            proxy.setActive(true);
            assertTrue(request(proxy, request).contains("403 Forbidden"));
            assertEquals(AgentBrowserProxy.Failure.ADDRESS, proxy.failureFor("example.com", 0));
            assertEquals(0, queries.get());
            proxy.allowPublicDns();
            assertTrue(request(proxy, request).contains("403 Forbidden"));
            assertEquals(AgentBrowserProxy.Failure.PUBLIC_DNS, proxy.failureFor("example.com", 0));
            assertEquals(1, queries.get());
            proxy.setActive(false);
            proxy.setActive(true);
            assertTrue(request(proxy, request).contains("403 Forbidden"));
            assertEquals(1, queries.get());
        }
    }

    @Test public void alternateResolverAcceptsOnlyNumericPublicAnswers() throws Exception {
        String publicAnswer = "{\"Status\":0,\"Answer\":[{\"type\":5,\"data\":\"example.org.\"},{\"type\":1,\"data\":\"93.184.215.14\"}]}";
        assertArrayEquals(new InetAddress[]{InetAddress.getByName("93.184.215.14")}, AgentBrowserDns.parse(publicAnswer, 1));
        for (String forbidden : new String[]{"192.168.1.1", "198.18.0.1", "example.org", "127.0.0.1"}) {
            assertThrows(java.io.IOException.class, () -> AgentBrowserDns.parse(publicAnswer.replace("93.184.215.14", forbidden), 1));
        }
        assertThrows(java.io.IOException.class, () -> AgentBrowserDns.parse(publicAnswer.replace("\"Status\":0", "\"Status\":3"), 1));
    }
}
