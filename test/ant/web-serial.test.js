import { MessageTransformer } from '../../src/ant/web-serial.js';

function frame(payload = [0]) {
    return Uint8Array.from([0xA4, payload.length + 1, 0x4E, 0, ...payload, 0]);
}

function transform(chunks) {
    const parser = new MessageTransformer();
    const messages = [];
    const controller = {enqueue: message => messages.push(Array.from(message))};
    chunks.forEach(chunk => parser.transform(Uint8Array.from(chunk), controller));
    return messages;
}

describe('ANT+ serial framing', () => {
    test('retains partial frames and emits them when completed', () => {
        const bytes = frame([1, 2, 3]);
        expect(transform([bytes.slice(0, 3), bytes.slice(3)])).toEqual([Array.from(bytes)]);
    });

    test('emits all complete frames and skips bytes before sync', () => {
        const first = frame([1]);
        const second = frame([2, 3]);
        expect(transform([[0, 1, ...first, ...second]])).toEqual([
            Array.from(first),
            Array.from(second),
        ]);
    });

});
