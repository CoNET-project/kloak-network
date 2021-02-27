"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Express = require("express");
const path_1 = require("path");
const Imap = require("./imap");
class localServer {
    constructor(portNumber) {
        this.expressServer = Express();
        Express.static.mime.define({ 'application/x-mimearchive': ['mhtml', 'mht'] });
        this.expressServer.use('/', Express.static(path_1.join(__dirname, `../public`)));
        this.expressServer.use(`/assets`, Express.static(path_1.join(__dirname, `../assets`)));
        /**
             * 404 Cannot GET
         *
        this.expressServer.get ( '*', ( req, res ) => {
            res.end (`Cannot GET ${ req.url }\n__dirname = ${ __dirname }`)
        })
        /** */
        this.expressServer.once('error', err => {
            console.log(`httpServer error`, err);
            return process.exit(1);
        });
        /**
         * 			POST JSON
         * 			imapAccount: string
         * 			imapPassword: string
         * 			imapServer: string
         * 			port: number
         *
         * 			response:
         * 			200		imap test passed
         * 			400		json format error
         * 			401		IMAP server auth error
         * 			408 	IMAP server can not connected Timeout
         *
         */
        this.expressServer.post('testImap', (req, res) => {
            const body = req.body;
            if (!body.imapServer || !body.imapUserName || !body.imapUserPassword || !body.imapPortNumber) {
                res.sendStatus(400);
                return res.end();
            }
            res.sendStatus(200);
            return Imap.imapAccountTest(body, (err, data) => {
                if (err) {
                    res.sendStatus(400);
                }
                return res.end();
            });
        });
        this.expressServer.listen(portNumber, () => {
            console.table([{ 'Kloak start up at': `localhost:${portNumber}` }]);
        });
    }
}
exports.default = localServer;
