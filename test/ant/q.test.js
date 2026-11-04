/*
 * q.test.js: test coverage module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * documents the expected behavior of the application and prevents regressions during development.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { Q } from '../../src/ant/q.js';
import { message } from '../../src/ant/message.js';
import { events, ids } from '../../src/ant/constants.js';

describe('ANT+ command acknowledgements', () => {
    test('resolves a command when its successful response arrives', async () => {
        const queue = Q();
        const command = message.openChannel.encode({channelNumber: 1});
        const pending = queue.push(command);
        const response = message.channelResponse.decode(message.channelResponse.encode({
            channelNumber: 1,
            initMsgId: ids.openChannel,
            responseCode: events.response_no_error,
        }));

        queue.pull(response);
        await expect(pending).resolves.toEqual(response);
    });

    test('rejects a command when the adapter reports an error', async () => {
        const queue = Q();
        const command = message.openChannel.encode({channelNumber: 1});
        const pending = queue.push(command);
        const response = message.channelResponse.decode(message.channelResponse.encode({
            channelNumber: 1,
            initMsgId: ids.openChannel,
            responseCode: events.channel_not_opened,
        }));

        queue.pull(response);
        await expect(pending).rejects.toThrow('was rejected');
    });

    test('resolves acknowledged data on its transfer-completed event', async () => {
        const queue = Q();
        const command = message.acknowledgedData.encode({
            channelNumber: 1,
            payload: new Uint8Array(8),
        });
        const pending = queue.push(command);
        const event = message.channelEvent.decode(message.channelEvent.encode({
            channelNumber: 1,
            eventCode: events.event_transfer_tx_completed,
        }));

        queue.pull(event);
        await expect(pending).resolves.toEqual(event);
    });

    test('rejects pending commands when the transport closes', async () => {
        const queue = Q();
        const pending = queue.push(message.openChannel.encode({channelNumber: 1}));

        queue.rejectAll();
        await expect(pending).rejects.toThrow('ANT+ driver closed');
    });
});
