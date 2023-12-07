/**
 * @@ XRAY | Graph | IPFS Images CDN Proxy
 * Proxying CIP25, CIP26, CIP68, or REGISTRY images from `xray-ipfs-images-cdn`
 * !!! Will be deprecated soon: moving to self-hosted IPFS caching solution
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { Buffer } from "node:buffer"
import * as Types from "./types"

const API_GROUP = "cdn"
const ALLOWED_METHODS = ["GET", "POST", "OPTIONS", "HEAD"]
const ALLOWED_NETWORKS = ["mainnet", "preprod", "preview"]
const IMG_SIZES = ["32", "64", "128", "256", "512", "1024", "2048"]

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { segments, pathname, search } = getUrlSegments(new URL(request.url))
		const [group, network, type, fingerprint, size] = segments

		if (request.method === "OPTIONS") {
			return new Response(null, {
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
					"Access-Control-Max-Age": "86400",
					"Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
				},
			})
		}

		if (!ALLOWED_METHODS.includes(request.method)) return throw405()
		if (group !== API_GROUP) return throw404()
		if (!ALLOWED_NETWORKS.includes(network)) return throw404()
		if (!fingerprint) return throw404()
		if (!IMG_SIZES.includes(size)) return throw404WrongSize()

		try {
			return new Response("Hello world!")
			return throw404NoImage()
		} catch (error) {
			console.log(error)
			return throw404NoImage()
		}
	},
}

const getUrlSegments = (url: URL) => {
	const pathname = url.pathname
	const search = url.search
	const segments = pathname.replace(/^\//g, "").split("/")

	return {
		segments,
		pathname,
		search,
	}
}

const throw404 = () => {
	return new Response("404. API not found. Check if the request is correct", { status: 404 })
}

const throw404NoImage = () => {
	return new Response("404. Image not found! Check if the request is correct", { status: 404 })
}

const throw404ImageTooLarge = () => {
	return new Response("404. Image too large! The image exceeded the size limit of 20000000 bytes", { status: 404 })
}

const throw404CIPNotSupported = () => {
	return new Response("404. Current CIP is not yet supported", { status: 404 })
}

const throw404WrongSize = () => {
	return new Response("404. Image size not found! Check if the request is correct", { status: 404 })
}

const throw405 = () => {
	return new Response("405. Method not allowed. Check if the request is correct", { status: 405 })
}

const throw500 = () => {
	return new Response("500. Server error! Something went wrong", { status: 500 })
}

const throwReject = (response: Response) => {
	return new Response(response.body, response)
}
