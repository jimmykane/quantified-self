export async function get(urlOrOptions: string | any, options: any = {}) {
    return request(urlOrOptions, { ...options, method: 'GET' });
}

export async function post(urlOrOptions: string | any, options: any = {}) {
    return request(urlOrOptions, { ...options, method: 'POST' });
}

export async function put(urlOrOptions: string | any, options: any = {}) {
    return request(urlOrOptions, { ...options, method: 'PUT' });
}

export async function del(urlOrOptions: string | any, options: any = {}) {
    return request(urlOrOptions, { ...options, method: 'DELETE' });
}

async function request(urlOrOptions: string | any, options: any = {}) {
    let url: string;
    let opts: any;

    if (typeof urlOrOptions === 'string') {
        url = urlOrOptions;
        opts = options;
    } else {
        url = urlOrOptions.url || urlOrOptions.uri;
        if (!url) throw new Error('Missing URL in options');
        opts = { ...urlOrOptions, ...options };
    }

    const fetchOptions: any = {
        method: opts.method || 'GET',
        headers: opts.headers || {},
    };

    if (opts.body) {
        if (typeof opts.body === 'object' && opts.json !== false) {
            fetchOptions.body = JSON.stringify(opts.body);
            if (!fetchOptions.headers['Content-Type']) {
                fetchOptions.headers['Content-Type'] = 'application/json';
            }
        } else {
            fetchOptions.body = opts.body;
        }
    } else if (opts.form) {
        const params = new URLSearchParams();
        for (const key in opts.form) {
            params.append(key, opts.form[key]);
        }
        fetchOptions.body = params;
    }

    if (opts.auth && opts.auth.bearer) {
        fetchOptions.headers['Authorization'] = `Bearer ${opts.auth.bearer}`;
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
        const err: any = new Error(`StatusCodeError: ${response.status} - ${response.statusText}`);
        err.statusCode = response.status;
        try {
            err.error = await response.text();
            try {
                err.error = JSON.parse(err.error);
            } catch { // ignore
            }
        } catch { // ignore
        }
        throw err;
    }

    if (opts.encoding === null) {
        return Buffer.from(await response.arrayBuffer());
    }

    // Default to JSON parsing only if json: true is explicitly set (matching request-promise-native)
    if (opts.json === true) {
        return response.json();
    }

    return response.text();
}

const requestFn = request as any;
requestFn.get = get;
requestFn.post = post;
requestFn.put = put;
requestFn.delete = del;

export { del as delete };

export default requestFn;
