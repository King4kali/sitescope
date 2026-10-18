# Runtime boundaries

`Dockerfile` builds the TypeScript services and Next application. `browser.Dockerfile` pins the Playwright package and Linux browser image to the same version. The runner runs as pwuser with a read-only root, tmpfs, explicit resource limits and the Chromium sandbox. It receives only a proxy URL and port, no database, storage or SMTP credentials.

`chromium-seccomp.json` is the Playwright seccomp profile from the Microsoft Playwright repository (`utils/docker/seccomp_profile.json`, v1.56.1), distributed under the project's Apache-2.0 license. Source: https://github.com/microsoft/playwright/blob/v1.56.1/utils/docker/seccomp_profile.json. SiteScope adds a clone3 ENOSYS fallback for modern glibc and allows the chroot syscall needed inside Chromium's private user namespace. All container host capabilities remain dropped: a nonroot process cannot chroot the host namespace. The upstream chroot rule was conditional on CAP_SYS_CHROOT and otherwise blocked Chromium's own sandbox after cap_drop=ALL. Upstream guidance: https://playwright.dev/docs/docker.

The `browser-control` and `browser-egress` networks are internal networks. The browser has no general outbound route. Only the proxy joins `browser-egress` and `outbound`. The proxy validates public DNS, rejects private/special IPv4/IPv6 addresses, opens sockets to validated IPs and bounds connections and bytes. API/worker HTTP checks use the same core validation and IP pinning. Never expose proxy or runner ports publicly.

Development Compose is not a standalone production security certification. See docs/DEPLOYMENT.md for target-host requirements.
