/**
 * ZEUS 가입 신청 전용 Cloudflare Worker
 * 브라우저의 신청 POST만 받아 Cloudflare가 제공한 실제 접속 IP를 덧붙여 Apps Script로 전달합니다.
 * 일반 페이지 조회 요청은 이 Worker로 오지 않으며 어떠한 시트 기록도 하지 않습니다.
 */

function cleanText(value, maxLength = 120) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function osFromUserAgent(userAgent) {
  if (/Android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Windows NT/i.test(userAgent)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macOS";
  if (/CrOS/i.test(userAgent)) return "ChromeOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "확인 불가";
}

function modelFromUserAgent(userAgent) {
  const samsungModel = userAgent.match(/\b(SM-[A-Z0-9]+)\b/i);
  if (samsungModel) return samsungModel[1].toUpperCase();
  if (/iPhone/i.test(userAgent)) return "iPhone (세부 모델 미제공)";
  if (/iPad/i.test(userAgent)) return "iPad (세부 모델 미제공)";
  if (/Android/i.test(userAgent)) return "Android 기기 (세부 모델 미제공)";
  if (/Windows|Macintosh|X11|Linux/i.test(userAgent)) return "데스크톱 (세부 모델 미제공)";
  return "확인 불가";
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== "POST" || url.pathname !== "/submit") {
      return new Response("Not Found", { status: 404 });
    }

    // GitHub Pages에서 제출된 요청만 허용합니다. ALLOWED_ORIGIN은 wrangler.jsonc에서 설정합니다.
    const origin = request.headers.get("Origin") || "";
    if (origin !== env.ALLOWED_ORIGIN) {
      return new Response("Forbidden", { status: 403 });
    }

    if (!env.APPS_SCRIPT_URL || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(env.APPS_SCRIPT_URL)) {
      return jsonResponse({ success: false, message: "Apps Script URL 설정이 올바르지 않습니다." }, 500);
    }

    let formData;
    try {
      formData = await request.formData();
    } catch (error) {
      return jsonResponse({ success: false, message: "신청서 전송 형식이 올바르지 않습니다." }, 400);
    }

    const requestId = cleanText(formData.get("requestId"), 100);
    const rawPayload = formData.get("payload");
    if (!requestId || !/^[A-Za-z0-9_-]+$/.test(requestId) || typeof rawPayload !== "string") {
      return jsonResponse({ success: false, message: "신청서 정보가 누락되었습니다." }, 400);
    }

    let application;
    try {
      application = JSON.parse(rawPayload);
    } catch (error) {
      return jsonResponse({ success: false, message: "신청서 내용을 해석할 수 없습니다." }, 400);
    }

    if (!application || typeof application !== "object" || Array.isArray(application)) {
      return jsonResponse({ success: false, message: "신청서 형식이 올바르지 않습니다." }, 400);
    }

    const clientInfo = application.clientInfo && typeof application.clientInfo === "object"
      ? application.clientInfo
      : {};
    const userAgent = request.headers.get("User-Agent") || "";
    const clientIp = cleanText(request.headers.get("CF-Connecting-IP"), 64);
    const headerModel = (request.headers.get("Sec-CH-UA-Model") || "").replace(/^"|"$/g, "");
    const headerPlatform = (request.headers.get("Sec-CH-UA-Platform") || "").replace(/^"|"$/g, "");

    // IP는 브라우저가 보낸 값을 신뢰하지 않고 Cloudflare 엣지 헤더에서만 가져옵니다.
    const enrichedPayload = {
      ...application,
      ipAddress: clientIp,
      os: cleanText(clientInfo.os || headerPlatform || osFromUserAgent(userAgent), 80),
      deviceModel: cleanText(clientInfo.model || headerModel || modelFromUserAgent(userAgent), 100)
    };
    delete enrichedPayload.clientInfo;

    const forwardedBody = new URLSearchParams();
    forwardedBody.set("requestId", requestId);
    forwardedBody.set("payload", JSON.stringify(enrichedPayload));

    try {
      const upstream = await fetch(env.APPS_SCRIPT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: forwardedBody.toString(),
        redirect: "follow"
      });

      const responseText = await upstream.text();
      return new Response(responseText, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=UTF-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
    } catch (error) {
      // IP와 신청내용은 오류 로그에 남기지 않습니다.
      return jsonResponse({ success: false, message: "가입 신청 서버에 연결하지 못했습니다." }, 502);
    }
  }
};
