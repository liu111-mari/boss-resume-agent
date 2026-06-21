(function initializeJobExtractor(globalScope) {
  function extractVisibleJobs(documentRef, sourcePage) {
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
      const text = normalize(card?.textContent || link.textContent || "");
      const title = normalize(link.textContent || "") || pickJobTitle(text) || "未知岗位";
      if (!title || title === "查看更多信息") continue;

      const companyLink = card?.querySelector("a[href*='/gongsi/']");
      const company = normalize(companyLink?.textContent || "") || pickCompany(text) || "未知公司";
      const city = pickCity(text);
      const salary = (text.match(/\d{2,3}-\d{2,3}元\/天|\d{1,3}-\d{1,3}[Kk](?:·\d+薪)?|\d+元\/天/) || [""])[0];

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
        jdText: text.slice(0, 3000),
        collectedAt: new Date().toISOString()
      });
    }

    return jobs.slice(0, 50);
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

  function normalize(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function stableId(input) {
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
      hash = (hash << 5) - hash + input.charCodeAt(index);
      hash |= 0;
    }
    return `boss-${Math.abs(hash)}`;
  }

  const api = { extractVisibleJobs };
  globalScope.BossJobExtractor = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
