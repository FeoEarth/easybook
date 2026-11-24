package com.feoearth.easybook;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Dedicated CONNECT transport. Gecko still owns end-to-end TLS verification. */
final class AgentBrowserProxy implements AutoCloseable {
    private final ServerSocket listener = new ServerSocket(0, 32, InetAddress.getByName("127.0.0.1"));
    private final ExecutorService workers = Executors.newFixedThreadPool(64);
    private final Set<Socket> sockets = new HashSet<>();
    private long generation;
    private boolean active;
    private String probeHost;
    private Runnable probeNotice;

    AgentBrowserProxy() throws IOException {
        workers.execute(this::accept);
    }

    int port() { return listener.getLocalPort(); }

    @Override public void close() throws IOException {
        setActive(false);
        listener.close();
        workers.shutdownNow();
    }

    synchronized void setActive(boolean active) {
        this.active = active;
        generation++;
        probeHost = null;
        probeNotice = null;
        for (Socket socket : sockets) close(socket);
        sockets.clear();
    }

    synchronized void expectProbe(String host, Runnable notice) {
        probeHost = host;
        probeNotice = notice;
    }

    private synchronized boolean seeProbe(String host, long lease) {
        if (!active || lease != generation || !host.equals(probeHost)) return false;
        probeNotice.run();
        probeHost = null;
        probeNotice = null;
        return true;
    }

    static URI publicUrl(String value) {
        if (value == null || value.length() > 2048) throw new IllegalArgumentException("无效的网址");
        URI uri = URI.create(value);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getRawUserInfo() != null ||
            uri.getPort() != -1 && uri.getPort() != 443 || !publicHost(uri.getHost())) {
            throw new SecurityException("浏览器仅允许公开 HTTPS 网页");
        }
        return uri;
    }

    private static boolean publicHost(String host) {
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        if (host.length() > 253 || !host.matches("[a-z0-9-]+(\\.[a-z0-9-]+)*\\.[a-z][a-z0-9-]*")) return false;
        for (String suffix : new String[]{"local","localhost","internal","lan","home","invalid","test","onion"}) {
            if (host.endsWith("." + suffix)) return false;
        }
        return !host.equals("appassets.androidplatform.net") && !host.endsWith(".easybook.invalid");
    }

    static boolean publicDestination(InetAddress address) {
        if (!PublicNetworkAddress.isPublic(address)) return false;
        byte[] bytes = address.getAddress();
        if (bytes.length == 4) return true;
        // Only global IPv6 unicast. Exclude transition and special-use prefixes.
        return (bytes[0] & 0xe0) == 0x20 && !(bytes[0] == 0x20 && (bytes[1] == 2 ||
            bytes[1] == 1 && ((bytes[2] & 0xff) < 2 || bytes[2] == 0x0d && bytes[3] == (byte) 0xb8)));
    }

    private void accept() {
        while (!listener.isClosed()) {
            try {
                Socket client = listener.accept();
                synchronized (this) {
                    if (!active || sockets.size() >= 28) { close(client); continue; }
                    sockets.add(client);
                    long lease = generation;
                    workers.execute(() -> connect(client, lease));
                }
            } catch (IOException ignored) { return; }
        }
    }

    private void connect(Socket client, long lease) {
        Socket remote = null;
        try {
            client.setSoTimeout(12000);
            InputStream input = client.getInputStream();
            String header = requestHeader(input);
            String[] request = header.substring(0, header.indexOf("\r\n")).split(" ", -1);
            if (request.length != 3 || !request[0].equals("CONNECT") || !request[2].matches("HTTP/1\\.[01]") ||
                !request[1].endsWith(":443")) throw new IOException("Invalid tunnel");
            String host = request[1].substring(0, request[1].length() - 4);
            if (seeProbe(host, lease)) throw new IOException("Local proxy check");
            if (!publicHost(host)) throw new IOException("Invalid destination");
            remote = connectPublic(InetAddress.getAllByName(host), lease);
            remote.setSoTimeout(30000);
            client.setSoTimeout(30000);
            client.getOutputStream().write("HTTP/1.1 200 Connection Established\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
            Socket target = remote;
            workers.execute(() -> relay(target, client));
            relay(client, target);
        } catch (IOException | RuntimeException ignored) {
            try { client.getOutputStream().write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".getBytes(StandardCharsets.US_ASCII)); }
            catch (IOException ignoredWrite) { }
        } finally {
            close(client);
            close(remote);
            synchronized (this) { sockets.remove(client); sockets.remove(remote); }
        }
    }

    static List<InetAddress> connectionOrder(InetAddress[] resolved) throws IOException {
        List<InetAddress> candidates = new ArrayList<>(Arrays.asList(resolved));
        for (InetAddress candidate : candidates) if (!publicDestination(candidate)) throw new IOException("Private destination");
        if (candidates.isEmpty()) throw new IOException("No destination");
        int family = candidates.get(0).getAddress().length;
        for (int i = 1; i < candidates.size(); i++) {
            if (candidates.get(i).getAddress().length != family) {
                candidates.add(1, candidates.remove(i));
                break;
            }
        }
        return candidates;
    }

    private Socket connectPublic(InetAddress[] resolved, long lease) throws IOException {
        List<InetAddress> candidates = connectionOrder(resolved);
        IOException failure = null;
        for (InetAddress address : candidates.subList(0, Math.min(4, candidates.size()))) {
            Socket remote = new Socket();
            try {
                synchronized (this) {
                    if (!active || lease != generation) throw new IOException("Expired tunnel");
                    sockets.add(remote);
                }
                // Connect to the validated address itself without a second DNS lookup.
                remote.connect(new InetSocketAddress(address, 443), 2500);
                return remote;
            } catch (IOException error) {
                failure = error;
                close(remote);
                synchronized (this) {
                    sockets.remove(remote);
                    if (!active || lease != generation) throw error;
                }
            }
        }
        throw failure;
    }

    private static String requestHeader(InputStream input) throws IOException {
        StringBuilder header = new StringBuilder();
        while (header.length() < 8192) {
            int next = input.read();
            if (next < 0 || next > 127) break;
            header.append((char) next);
            int length = header.length();
            if (length >= 4 && header.substring(length - 4).equals("\r\n\r\n")) return header.toString();
        }
        throw new IOException("Invalid tunnel header");
    }

    private static void relay(Socket from, Socket to) {
        try {
            InputStream input = from.getInputStream();
            java.io.OutputStream output = to.getOutputStream();
            byte[] buffer = new byte[8192];
            for (int size; (size = input.read(buffer)) != -1;) output.write(buffer, 0, size);
        } catch (IOException ignored) { }
        finally { close(from); close(to); }
    }

    private static void close(Socket socket) {
        if (socket != null) try { socket.close(); } catch (IOException ignored) { }
    }
}
