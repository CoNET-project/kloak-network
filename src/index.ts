import * as Express from 'express'
import * as Http from 'http'
import { join } from 'path'
import * as Imap from './imap'

export default class localServer {
	private expressServer = Express ()
	private httpServer = Http.createServer ( this.expressServer )
	constructor ( portNumber: number ) {
	
		Express.static.mime.define ({ 'application/x-mimearchive' : ['mhtml','mht'] })
		this.expressServer.set ( 'views', join ( __dirname, 'views' ))
		this.expressServer.use ( '/', Express.static ( join ( __dirname, `../public` )))
		this.expressServer.use ( `/assets`, Express.static ( join ( __dirname, `../assets` )))
		
		/**
			 * 404 Cannot GET
		 *
		this.expressServer.get ( '*', ( req, res ) => {
			res.end (`Cannot GET ${ req.url }\n__dirname = ${ __dirname }`)
		})
		/** */

		this.httpServer.once ( 'error', err => {
			console.log ( `httpServer error`, err )
			return process.exit (1)
		})
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

		this.expressServer.post (　'testImap', ( req, res ) => {
			const body: imapConnect = req.body
			if ( !body.imapServer || ! body.imapUserName || !body.imapUserPassword || !body.imapPortNumber ) {
				res.sendStatus ( 400 )
				return res.end ()
			}
			res.sendStatus ( 200 )
			return Imap.imapAccountTest ( body, ( err, data ) => {
				if ( err ) {
					res.sendStatus ( 400 )
				}
				return res.end()
			})
			
		})
		
		this.httpServer.listen ( portNumber, () => {
			console.table ([{ 'Kloak start up at': `localhost:${ portNumber }`}])
		})
	}
	
}