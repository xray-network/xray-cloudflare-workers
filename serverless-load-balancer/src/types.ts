export type ServersInitialConfig = {
	host: string
	active: boolean
	services: {
		name: string
		network: string
		version: string
		active: boolean
	}[]
}[]

export type ServerConfig = {
	[network: string]: {
		[service: string]: {
			[version: string]: {
				active: boolean
				healthUrl: string
				host: string
				hostResolver: string
				id: string
			}[]
		}
	}
}

export type Server = {
	name: string
	url: string
	healthy: boolean
}

export type MapHealthPathname = {
	[serviceName: string]: string
}
