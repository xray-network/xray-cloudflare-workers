/**
 * @@ XRAY | Graph
 * Cloudflare IPFS (or Registry) to Images CDN
 * !!! Will be deprecated soon: moving to self-hosted IPFS caching solution
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { Buffer } from "node:buffer"
import * as Types from "./types"

const API_GROUP = "cdn"
const API_TYPES = ["metadata", "registry"]
const API_IPFS = "https://nftstorage.link"
const API_KOIOS = (network: string) => `https://binding-fake-url/output/${network}/koios/api/v1`
const ALLOWED_METHODS = ["GET", "POST", "OPTIONS", "HEAD"]
const ALLOWED_NETWORKS = ["mainnet", "preprod", "preview"]
const IMG_SIZES = ["32", "64", "128", "256", "512", "1024", "2048"]
const HIDDEN_SIZE = "50"
const IMG_SIZE_LIMIT = 20_000_000 // CF Upload Limit in bytes

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
		if (!API_TYPES.includes(type)) return throw404()
		if (!ALLOWED_NETWORKS.includes(network)) return throw404()
		if (!fingerprint) return throw404()
		if (!IMG_SIZES.includes(size)) return throw404WrongSize()

		try {
			if (type === "metadata") {
				try {
					// Check if image exist in CF Images and serve image
					await checkImageExistInCFByAPI(type, fingerprint, env)
					// await checkImageExistInCFByHiddenSize(fingerprint, env) // TODO: see func description
					return await serveImageFromCF(type, fingerprint, size, request, env)
				} catch {
					// If not found, get image by CIP25 metadata, upload to CF and serve image
					const imageProvider = await getImageDataProvider(fingerprint, network, env)

					if (imageProvider.metadataProvider.type === "base64") {
						const imageBase64 = imageProvider.metadataProvider.data
						await uploadImageBase64ToCF(imageBase64, type, fingerprint, env)
						return await serveImageFromCF(type, fingerprint, size, request, env)
					}
					
					if (imageProvider.metadataProvider.type === "http" || imageProvider.metadataProvider.type === "ipfs") {
						const imageRemoteURL = imageProvider.metadataProvider.data
						const imageResponse = await fetch(imageRemoteURL)
						if (!imageResponse.ok) throw new Error("Error getting image from IPFS")
						if (Number(imageResponse.headers.get("content-length") || 0) > IMG_SIZE_LIMIT)
							return throw404ImageTooLarge()
						const imageBase64 = Buffer(await imageResponse.clone().arrayBuffer()).toString("base64") // TODO: Long run, should be optimized
						await uploadImageBase64ToCF(imageBase64, type, fingerprint, env)
						return await serveImageFromCF(type, fingerprint, size, request, env)
					}
				}
			}

			if (type === "registry") {
				try {
					// Check if image exist in CF Images and serve image
					await checkImageExistInCFByAPI(type, fingerprint, env)
					// await checkImageExistInCFByHiddenSize(fingerprint, env) // TODO: see func description
					return await serveImageFromCF(type, fingerprint, size, request, env)
				} catch {
					const { registryBase64Image } = await getImageDataProvider(fingerprint, network, env)
					if (registryBase64Image) {
						await uploadImageBase64ToCF(registryBase64Image, type, fingerprint, env)
						return await serveImageFromCF(type, fingerprint, size, request, env)
					}
				}
			}

			return throw404NoImage()
		} catch (error) {
			console.log(error)
			return throw404NoImage()
		}
	},
}

// TODO: Slowing request by ~800ms, has limits
const checkImageExistInCFByAPI = async (type: string, fingerprint: string, env: Env) => {
	const result = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/images/v1/${type}/${fingerprint}`,
		{
			headers: { Authorization: `Bearer ${env.ACCOUNT_KEY}` },
		}
	)
	if (result.ok) return
	throw new Error("Image doesn't exist")
}

// TODO: Working with bugs (cached as 404)
// The hidden size is needed to bypass the negative Workers cache. Otherwise some sizes will be unavailable (404) after uploading the image for the 30-60 secs, because the first `fetch` was cached
const checkImageExistInCFByHiddenSize = async (type: string, fingerprint: string, env: Env) => {
	const result = await fetch(
		`https://imagedelivery.net/${env.ACCOUNT_HASH}/${type}/${fingerprint}/${HIDDEN_SIZE}?${Date.now()}`,
		{
			cf: { cacheTtl: 0, cacheEverything: false },
		}
	)
	if (result.ok) return
	throw new Error("Image doesn't exist")
}

const serveImageFromCF = async (type: string, fingerprint: string, size: string, request: Request, env: Env) => {
	const imageResponse = await fetch(
		`https://imagedelivery.net/${env.ACCOUNT_HASH}/${type}/${fingerprint}/${size}?${Date.now()}`,
		{
			headers: request.headers,
			cf: { cacheTtl: 0, cacheEverything: false },
		}
	)

	// Handle not modified status
	if (imageResponse.status === 304) {
		const responseHeaders = new Headers(imageResponse.headers)
		responseHeaders.delete("Content-Security-Policy")
		return new Response(null, { headers: responseHeaders, status: 304 })
	}

	// Send response with caching headers
	if (imageResponse.ok) {
		const responseHeaders = new Headers(imageResponse.headers)
		responseHeaders.set("Cache-Control", "public, max-age=864000000")
		responseHeaders.set("Expires", new Date(Date.now() + 864_000_000_000).toUTCString())
		responseHeaders.delete("Content-Security-Policy")
		return new Response(imageResponse.body, { headers: responseHeaders })
	}

	throw new Error("Error getting image from CF")
}

const uploadImageBase64ToCF = async (imageBase64: string, type: string, fingerprint: string, env: Env) => {
	const data = Buffer.from(imageBase64, "base64")
	const imageFormData = new FormData()
	imageFormData.append("file", new Blob([data]))
	imageFormData.append("id", `${type}/${fingerprint}`)
	const imageUploadResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/images/v1`, {
		method: "POST",
		headers: { Authorization: `Bearer ${env.ACCOUNT_KEY}` },
		body: imageFormData,
	})
	if (!imageUploadResponse.ok) throw new Error("Error uploading image to CF")
	return await imageUploadResponse.json()
}

const getImageDataProvider = async (
	fingerprint: string,
	network: string,
	env: Env
): Promise<Types.ImageDataProvider> => {
	const assetInfoResponse = await env.OUTPUT.fetch(`${API_KOIOS(network)}/asset_list?fingerprint=eq.${fingerprint}`)
	if (!assetInfoResponse.ok) throw new Error("Error getting asset info")
	const assetInfoResult: any = await assetInfoResponse.json()
	const assetPolicyId = assetInfoResult[0]?.policy_id
	const assetName = assetInfoResult[0]?.asset_name

	const assetDataResponse = await env.OUTPUT.fetch(
		`${API_KOIOS(
			network
		)}/asset_info?select=asset_name_ascii,minting_tx_metadata,cip68_metadata,token_registry_metadata`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ _asset_list: [[assetPolicyId, assetName]] }),
		}
	)
	if (!assetDataResponse.ok) throw new Error("Error getting asset data")

	const assetDataResult: any = await assetDataResponse.json()
	const assetNameAscii = assetDataResult[0]?.asset_name_ascii
	const assetTxMetadata = assetDataResult[0]?.minting_tx_metadata
	const cip68Metadata = assetDataResult[0]?.cip68_metadata
	const tokenRegistryMetadata = assetDataResult[0]?.token_registry_metadata

	const result = {
		metadataProvider: {},
		registryBase64Image: tokenRegistryMetadata?.logo || "",
	}

	let imageURI =
		assetTxMetadata?.["721"]?.[assetPolicyId]?.[assetNameAscii]?.image ||
		assetTxMetadata?.["721"]?.[assetPolicyId]?.[assetName]?.image

	if (!imageURI) throw new Error("Image in 721 metadata not found")

	if (Array.isArray(imageURI)) {
		imageURI = imageURI.join("")
	}

	if (typeof imageURI == "string") {
		if (imageURI.startsWith("https://") || imageURI.startsWith("http://")) {
			return {
				...result,
				metadataProvider: {
					type: "http",
					data: imageURI,
				},
			}
		} else if (imageURI.startsWith("ipfs://")) {
			return {
				...result,
				metadataProvider: {
					type: "ipfs",
					data: `${API_IPFS}/ipfs/${imageURI.replaceAll("ipfs://", "")}`,
				},
			}
		} else if (imageURI.startsWith("data:image/")) {
			return {
				...result,
				metadataProvider: {
					type: "base64",
					data: imageURI,
				},
			}
		}
	}

	throw new Error("Error getting image data from CIP25 metadata")
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
