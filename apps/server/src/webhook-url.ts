export const parseWecomWebhookUrl = (value: string) => {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "qyapi.weixin.qq.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/cgi-bin/webhook/send" ||
      !/^[a-zA-Z0-9-]{10,200}$/.test(url.searchParams.get("key") ?? "") ||
      [...url.searchParams.keys()].some((key) => key !== "key")
    )
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
};
