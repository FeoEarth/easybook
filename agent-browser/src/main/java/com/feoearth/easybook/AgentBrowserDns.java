package com.feoearth.easybook;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class AgentBrowserDns {
    private static final int MAX_RESPONSE_BYTES = 32768;

    private AgentBrowserDns() { }

    static InetAddress[] resolve(String host) throws IOException {
        // The fixed HTTPS endpoint does not depend on the system DNS answer being replaced.
        InetAddress[] addresses = query(host, 1);
        return addresses.length == 0 ? query(host, 28) : addresses;
    }

    private static InetAddress[] query(String host, int type) throws IOException {
        if (!host.equals(AgentBrowserProxy.publicUrl("https://" + host + "/").getHost())) throw new IOException("Invalid DNS name");
        URL endpoint = new URL("https://1.1.1.1/dns-query?name=" + host + "&type=" + type);
        HttpsURLConnection request = (HttpsURLConnection) endpoint.openConnection(Proxy.NO_PROXY);
        request.setConnectTimeout(3000);
        request.setReadTimeout(3000);
        request.setInstanceFollowRedirects(false);
        request.setRequestProperty("Accept", "application/dns-json");
        try {
            if (request.getResponseCode() != 200) throw new IOException("Public DNS request failed");
            try (InputStream input = request.getInputStream()) {
                ByteArrayOutputStream response = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                for (int count; (count = input.read(buffer)) != -1;) {
                    if (response.size() + count > MAX_RESPONSE_BYTES) throw new IOException("Public DNS response too large");
                    response.write(buffer, 0, count);
                }
                return parse(new String(response.toByteArray(), StandardCharsets.UTF_8), type);
            }
        } finally {
            request.disconnect();
        }
    }

    static InetAddress[] parse(String response, int type) throws IOException {
        try {
            JSONObject message = new JSONObject(response);
            if (message.getInt("Status") != 0 || message.optBoolean("TC")) throw new IOException("Public DNS lookup failed");
            JSONArray records = message.optJSONArray("Answer");
            List<InetAddress> addresses = new ArrayList<>();
            for (int i = 0; records != null && i < records.length(); i++) {
                JSONObject record = records.getJSONObject(i);
                if (record.getInt("type") != type) continue;
                String literal = record.getString("data");
                if (!(type == 1 ? literal.matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}") : literal.matches("[0-9a-fA-F:]*:[0-9a-fA-F:]*")))
                    throw new IOException("Invalid public DNS record");
                InetAddress address = InetAddress.getByName(literal);
                if (address.getAddress().length != (type == 1 ? 4 : 16) || !AgentBrowserProxy.publicDestination(address))
                    throw new IOException("Non-public DNS destination");
                addresses.add(address);
            }
            return addresses.toArray(new InetAddress[0]);
        } catch (JSONException error) {
            throw new IOException("Invalid public DNS response", error);
        }
    }
}
