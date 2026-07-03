(function initializeJobExtractor(globalScope) {
  function extractVisibleJobs(documentRef, sourcePage) {
    if (isJobDetailPage(sourcePage)) {
      const detailJob = extractCurrentJobDetail(documentRef, sourcePage);
      return detailJob ? [detailJob] : [];
    }

    const links = Array.from(documentRef.querySelectorAll("a[href*='/job_detail/']"));
    const seen = new Set();
    const jobs = [];

    for (const link of links) {
      const rawHref = link.getAttribute("href");
      if (!rawHref) continue;
      const detailUrl = new URL(rawHref, sourcePage).href;
      if (seen.has(detailUrl)) continue;
      seen.add(detailUrl);

      const card = findCardContainer(link);
      const text = normalize(decodeBossText(visibleText(card) || visibleText(link)));
      const title = normalize(visibleText(link)) || pickJobTitle(text) || "未知岗位";
      if (!title || title === "查看更多信息") continue;

      const companyLink = card?.querySelector("a[href*='/gongsi/']");
      const company = normalize(visibleText(companyLink)) || pickCompany(text) || "未知公司";
      const city = pickCity(text);
      const salary = pickSalary(text);

      jobs.push({
        id: stableId(`${detailUrl}-${title}-${company}`),
        title,
        company,
        city,
        salary,
        hrName: pickHr(text),
        hrActiveText: pickActive(text),
        detailUrl,
        sourcePage,
        jdText: pickCardSummary(card, { title, company, city, salary }).slice(0, 3000),
        jdSource: "list",
        collectedAt: new Date().toISOString()
      });
    }

    return jobs.slice(0, 50);
  }

  function extractCurrentJobDetail(documentRef, sourcePage) {
    const title = normalize(visibleText(documentRef.querySelector(".job-primary .name h1, .name h1")));
    const jdText = normalizeDescription(visibleText(documentRef.querySelector(".job-detail-section .job-sec-text:not(.fold-text), .job-sec-text:not(.fold-text)")));
    if (!title || !jdText) return null;

    const companyLink = Array.from(documentRef.querySelectorAll("a[href*='/gongsi/']")).find((link) => {
      const href = link.getAttribute("href") || "";
      return /\/gongsi\/[^/]+\.html(?:$|\?)/.test(href) && normalize(visibleText(link));
    });
    const company = normalize(visibleText(companyLink)) || "未知公司";
    const city = normalize(visibleText(documentRef.querySelector(".job-primary .text-city"))) || pickCity(visibleText(documentRef.body));
    const salaryText = decodeBossText(visibleText(documentRef.querySelector(".job-primary .salary, .company-info .salary")));
    const salary = pickSalary(salaryText);
    const experience = normalize(visibleText(documentRef.querySelector(".job-primary .text-experiece")));
    const education = normalize(visibleText(documentRef.querySelector(".job-primary .text-degree")));
    const detailUrl = new URL(sourcePage).href;
    const pageText = normalize(visibleText(documentRef.body));

    return {
      id: stableId(`${detailUrl}-${title}-${company}`),
      title,
      company,
      city,
      salary,
      hrName: pickHr(pageText),
      hrActiveText: pickActive(pageText),
      detailUrl,
      sourcePage,
      jdText: jdText.slice(0, 12000),
      jdSource: "detail",
      experience,
      education,
      collectedAt: new Date().toISOString()
    };
  }

  function findCardContainer(link) {
    const direct = link.closest(
      ".job-card-wrapper, .job-card-box, .job-list-box li, .job-primary, [class*='job-card'], [class*='job-list'] li"
    );
    if (direct) return direct;

    let current = link.parentElement;
    for (let depth = 0; current && depth < 7; depth += 1) {
      const text = normalize(current.textContent || "");
      if (
        current.querySelector("a[href*='/gongsi/']") ||
        (/北京|上海|杭州|深圳|广州|天津|南京|成都/.test(text) && text.length > 20)
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return link.parentElement;
  }

  function pickJobTitle(text) {
    const match = text.match(/(AI[^，。,\s]{0,18}|数据分析|商业分析|产品经理|产品运营|实施顾问|AI Agent|大模型应用|RAG)[^，。,\s]{0,16}/i);
    return match?.[0] || "";
  }

  function pickCompany(text) {
    const lines = text.split(/\s+/).filter(Boolean);
    return lines.find((line) => /科技|信息|智能|网络|数据|咨询|软件|云|教育/.test(line) && line.length <= 24) || "";
  }

  function pickCity(text) {
    const match = text.match(/北京|上海|杭州|深圳|广州|天津|南京|成都/);
    return match?.[0] || "";
  }

  function pickHr(text) {
    const activeAdjacent = text.match(
      /([\u4e00-\u9fa5]{1,4}(?:女士|先生|经理|HR|招聘))\s*(?:刚刚活跃|今日活跃|\d+小时内活跃|\d+日内活跃)/
    );
    if (activeAdjacent) return activeAdjacent[1];
    const match = text.match(/[\u4e00-\u9fa5]{1,4}(女士|先生|经理|HR|招聘)/);
    return match?.[0] || "";
  }

  function pickActive(text) {
    const match = text.match(/刚刚活跃|今日活跃|\d+小时内活跃|\d+日内活跃/);
    return match?.[0] || "";
  }

  function pickCardSummary(card, metadata) {
    if (!card) return "";
    const explicit = card.querySelector(
      ".job-card-body p, .job-card-info p, .job-detail, .job-desc, [class*='job-desc'], [class*='job-summary'], p"
    );
    const explicitText = normalize(decodeBossText(visibleText(explicit)));
    if (explicitText && !isOnlyMetadata(explicitText, metadata)) return explicitText;
    return "";
  }

  function isOnlyMetadata(text, metadata) {
    let rest = text;
    for (const value of Object.values(metadata)) {
      if (value) rest = rest.replaceAll(value, " ");
    }
    return normalize(rest).length < 16;
  }

  function pickSalary(text) {
    return (normalize(text).match(/\d{2,4}-\d{2,4}元\/天|\d{1,3}-\d{1,3}[Kk](?:·\d+薪)?|\d+元\/天/) || [""])[0];
  }

  function decodeBossText(text) {
    return String(text || "").replace(/[\uE031-\uE03A]/g, (character) =>
      String(character.charCodeAt(0) - 0xE031)
    );
  }

  function visibleText(node) {
    return node ? (node.innerText || node.textContent || "") : "";
  }

  function isJobDetailPage(sourcePage) {
    try {
      return new URL(sourcePage).pathname.includes("/job_detail/");
    } catch {
      return false;
    }
  }

  function normalize(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function normalizeDescription(text) {
    return decodeBossText(text)
      .replaceAll("来自BOSS直聘", "")
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  }

  function stableId(input) {
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
      hash = (hash << 5) - hash + input.charCodeAt(index);
      hash |= 0;
    }
    return `boss-${Math.abs(hash)}`;
  }

  const api = { decodeBossText, extractVisibleJobs };
  globalScope.BossJobExtractor = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
