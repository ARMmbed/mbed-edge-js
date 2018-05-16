/**
 * This example shows how you can use Mbed Cloud Edge to create multiple devices, set resources, and subscribe to resource updates
 */

const Edge = require('../');
const net = require('net');

(async function() {
    let deviceIx = 0;

    let edge;
    try {

        let tcpServer = net.createServer(function(socket) {
            console.log('got new socket');

            (async function() {
                console.log('gonna register');
                try {
                    let device = await edge.createCloudDevice('pplcounter' + (++deviceIx), 'people-counter');
                    console.log('whu?', device);
                    await device.register([
                        {
                            path: '/3321/0/5501',
                            operation: ['GET'],
                            value: '0'
                        }
                    ], false /* supports update */);
                    console.log('Registered', 'pplcounter' + deviceIx);

                    socket.device = device;
                }
                catch (ex) {
                    console.error('Failed to register', deviceIx, ex);
                }
            })();

            socket.on('data', (data) => {
                if (!socket.device) {
                    return console.error('data came in, but not registered yet');
                }

                console.log('new value is', data.toString('utf-8'));

                socket.device.resources['/3321/0/5501'].setValue(data.toString('utf-8')).then(() => {
                    console.log('setValue OK');
                }).catch((ex) => {
                    console.error('setValue failed');
                });
            });

            socket.on('close', () => {
                if (!socket.device) return;

                socket.device.deregister().then(() => {
                    console.log('device deregistered');
                }).catch(ex => {
                    console.error('deregister failed', ex);
                });
            })
        });
        tcpServer.listen(1337, '127.0.0.1');

        // make sure to deinit() when quit'ing this process
        let quitImmediately = false;
        let sigintHandler;
        process.on('SIGINT', sigintHandler = async function() {
            if (quitImmediately) process.exit(1);

            try {
                await edge.deinit();
            } catch (ex) {}
            process.exit(1);
        });

        edge = new Edge('192.168.122.129', 9100, 'opencv-processor');
        await edge.init();

        console.log('Connected to Mbed Cloud Edge');

    }
    catch (ex) {
        console.error('Error...', ex);

        await edge.deinit();
    }
})();
