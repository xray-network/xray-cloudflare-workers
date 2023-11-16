/**
 * Cloudflare Serverless Load Balancer
 * for XRAY | Graph Output Cluster
 * Learn more at https://developers.cloudflare.com/workers/
 */

import serversInitialConfig from "./configServers"
import * as Types from "./types"

const API_PROTOCOL = "https:"
const API_GROUP = "output"
const API_PREFIX = "api"
const ALLOWED_METHODS = ["GET", "POST", "OPTIONS", "HEAD"]
const MAP_HEALTH_PATHNAME: Types.MapHealthPathname = {
	koios: "tip",
	kupo: "health",
	ogmios: "health",
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const JWT_BEARER_TOKEN = env.JWT_BEARER_TOKEN

		const apis = getApisObject(serversInitialConfig, API_GROUP, API_PREFIX, API_PROTOCOL, MAP_HEALTH_PATHNAME)
		const {
			segments: [group, network, service, prefix, version],
			pathname,
			search,
		} = getUrlSegments(new URL(request.url))

		if (group !== API_GROUP) return throw404()
		if (network === "stats") return getStats() // Gather API Stats, with dirty route hack ofc :)
		if (prefix !== API_PREFIX) return throw404()
		if (!ALLOWED_METHODS.includes(request.method)) return throw405()
		if (request.headers.get("Upgrade") === "websocket") return throw404()
		if (request.headers.get("Connection") === "Upgrade") return throw404()
		if (!apis?.[network]?.[service]?.[version]) return throw404()

		const serversPool = apis[network][service][version]
		const serverRandom = serversPool[Math.floor(Math.random() * serversPool.length)] // TODO: Perform health check and select random server
		const __pathname = `${pathname.replace(/^\//g, "").slice(serverRandom.hostResolver.length)}`

		const response = await fetch(`${serverRandom.host}${__pathname}${search}`, {
			headers: {
				"HostResolver": serverRandom.hostResolver,
				...(env.JWT_BEARER_TOKEN && { "BearerResolver": env.JWT_BEARER_TOKEN })
			},
		})

		const delayedProcessing = async () => {
			const requestsCount = (await env.API_REQUESTS_COUNTER.get(serverRandom.id)) || 0
			await env.API_REQUESTS_COUNTER.put(serverRandom.id, (Number(requestsCount) + 1).toString())
		}
		ctx.waitUntil(delayedProcessing()) // Async update requests count (Workers KV)

		if (response.ok) {
			return new Response(response.body, { status: response.status, headers: response.headers })
		}

		if (response.status === 503) return throw503()
		if (response.status === 504) return throw504()
		return throwReject(response)
	},
}

const getApisObject = (
	servers: Types.ServersInitialConfig,
	apiGroup: string,
	apiPrefix: string,
	apiProtocol: string,
	mapHealthPathname: Types.MapHealthPathname,
): Types.ServerConfig => {
	return servers.reduce<Types.ServerConfig>((acc, server) => {
		if (!server.active) return acc

		acc = server.services.reduce<Types.ServerConfig>((innerAcc, service) => {
			if (!service.active) return innerAcc

			const networkConfig = innerAcc[service.network] ?? {}
			const serviceConfig = networkConfig[service.name] ?? {}
			const versionConfig = serviceConfig[service.version] ?? []

			versionConfig.push({
				active: service.active,
				healthUrl: `${apiProtocol}//${server.host}/${mapHealthPathname[service.name] || ""}`,
				host: `${apiProtocol}//${server.host}`,
				hostResolver: `${apiGroup}/${service.network}/${service.name}/${apiPrefix}/${service.version}`,
				id: `${server.host}/${apiGroup}/${service.network}/${service.name}/${apiPrefix}/${service.version}`,
			})

			serviceConfig[service.version] = versionConfig
			networkConfig[service.name] = serviceConfig
			innerAcc[service.network] = networkConfig

			return innerAcc
		}, acc)

		return acc
	}, {})
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

const getStats = () => {
	return new Response(JSON.stringify("stats_response"), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	})
}

const throw404 = () => {
	return new Response("404. API not found. Check if the request is correct", { status: 404 })
}

const throw405 = () => {
	return new Response("405. Method not allowed. Check if the request is correct", { status: 405 })
}

const throw503 = () => {
	return new Response("503. Service unavailable. No server is available to handle this request", { status: 503 })
}


const throw504 = () => {
	return new Response("504. Gateway time-out. The server didn't respond in time", { status: 504 })
}

const throwReject = (response: Response) => {
	return new Response(response.body, { status: response.status, headers: response.headers })
}

// Durable Objects are not used because KV delays are sufficient(?) for stats needs
// export class ApiRequestCounter {
//   state: DurableObjectState

//   constructor(state: DurableObjectState, env: Env) {
//     this.state = state
//   }

//   async fetch(request: Request) {
//     const url = new URL(request.url)
//     const value: number = await this.state.storage.get("value") || 0
//     switch (url.pathname) {
//       case "/increment":
//         const newValue = value + 1
//         await this.state.storage.put("value", newValue)
//         return new Response(newValue.toString())
//       default:
//         return new Response(value.toString())
//     }
//   }
// }
