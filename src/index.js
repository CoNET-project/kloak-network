"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Express = require("express");
const Http = require("http");
const path_1 = require("path");
const Imap = require("./imap");
const testImap = (imapAccount, imapPassword, imapServer, port, CallBack) => {
    Imap.imapAccountTest();
};
class localServer {
    constructor(portNumber) {
        this.expressServer = Express();
        this.httpServer = Http.createServer(this.expressServer);
        Express.static.mime.define({ 'application/x-mimearchive': ['mhtml', 'mht'] });
        this.expressServer.set('views', path_1.join(__dirname, 'views'));
        this.expressServer.use('/', Express.static(path_1.join(__dirname, `../public`)));
        this.expressServer.use(`/assets`, Express.static(path_1.join(__dirname, `../assets`)));
        /**
             * 404 Cannot GET
         *
        this.expressServer.get ( '*', ( req, res ) => {
            res.end (`Cannot GET ${ req.url }\n__dirname = ${ __dirname }`)
        })
        /** */
        this.httpServer.once('error', err => {
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
        this.expressServer.post('testImapSetup', (req, res) => {
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
        this.httpServer.listen(portNumber, () => {
            console.table([{ 'Kloak start up at': `localhost:${portNumber}` }]);
        });
    }
}
exports.default = localServer;
