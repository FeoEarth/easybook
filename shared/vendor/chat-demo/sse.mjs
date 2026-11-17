/*!
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
// Adapted from DeepSeek chat-demo; see NOTICE.md.

const LINE_BREAK = /\r\n|\r|\n/g;
class ServerSentEventDecoder {
  buffer = "";
  data = "";
  hasData = false;
  eventType = "";
  lastEventId = "";
  /** 输入一段已解码的文本，返回其中完整的事件 */
  push(text) {
    this.buffer += text;
    const events = [];
    let lineStart = 0;
    LINE_BREAK.lastIndex = 0;
    for (let match = LINE_BREAK.exec(this.buffer); match; match = LINE_BREAK.exec(this.buffer)) {
      if (match[0] === "\r" && LINE_BREAK.lastIndex === this.buffer.length) {
        break;
      }
      const event = this.processLine(this.buffer.slice(lineStart, match.index));
      if (event) {
        events.push(event);
      }
      lineStart = LINE_BREAK.lastIndex;
    }
    this.buffer = this.buffer.slice(lineStart);
    return events;
  }
  /** 流结束：结尾的 CR 是完整的换行，其余未以空行结尾的事件按规范丢弃 */
  end() {
    const event = this.buffer.endsWith("\r") ? this.processLine(this.buffer.slice(0, -1)) : null;
    this.buffer = "";
    this.data = "";
    this.hasData = false;
    this.eventType = "";
    return event ? [event] : [];
  }
  processLine(line) {
    if (line === "") {
      return this.dispatch();
    }
    if (line.startsWith(":")) {
      return null;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    switch (field) {
      case "data":
        this.data = this.hasData ? `${this.data}
${value}` : value;
        this.hasData = true;
        break;
      case "event":
        this.eventType = value;
        break;
      case "id":
        if (!value.includes("\0")) {
          this.lastEventId = value;
        }
        break;
      default:
        break;
    }
    return null;
  }
  dispatch() {
    const event = this.hasData ? { event: this.eventType || "message", data: this.data, lastEventId: this.lastEventId } : null;
    this.data = "";
    this.hasData = false;
    this.eventType = "";
    return event;
  }
}
async function* readServerSentEvents(stream, signal) {
  const reader = stream.getReader();
  const onAbort = () => {
    reader.cancel(signal?.reason).catch(() => {
    });
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const textDecoder = new TextDecoder();
  const decoder = new ServerSentEventDecoder();
  let finished = false;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        yield* decoder.push(textDecoder.decode());
        yield* decoder.end();
        return;
      }
      yield* decoder.push(textDecoder.decode(value, { stream: true }));
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!finished) {
      reader.cancel().catch(() => {
      });
    }
    reader.releaseLock();
  }
}
export {
  ServerSentEventDecoder,
  readServerSentEvents
};
