const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const { extractVisibleJobs } = require("../src/job-extractor.cjs");

test("extracts jobs from stable job_detail links without relying on card class names", () => {
  const dom = new JSDOM(`
    <main>
      <section class="unknown-card-v99">
        <a href="/job_detail/abc123.html">AI产品经理实习生</a>
        <span>150-220元/天</span>
        <a href="/gongsi/company1.html">北京智启未来科技</a>
        <span>北京·海淀区</span>
        <ul><li>在校/应届</li><li>本科</li><li>AI产品</li></ul>
      </section>
    </main>
  `, { url: "https://www.zhipin.com/web/geek/jobs" });

  const jobs = extractVisibleJobs(dom.window.document, "https://www.zhipin.com/web/geek/jobs");

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "AI产品经理实习生");
  assert.equal(jobs[0].company, "北京智启未来科技");
  assert.equal(jobs[0].city, "北京");
  assert.equal(jobs[0].detailUrl, "https://www.zhipin.com/job_detail/abc123.html");
});

test("deduplicates repeated links for the same job", () => {
  const dom = new JSDOM(`
    <div>
      <a href="/job_detail/repeated.html">数据分析实习生</a>
      <a href="/job_detail/repeated.html">数据分析实习生</a>
    </div>
  `, { url: "https://www.zhipin.com/web/geek/jobs" });

  const jobs = extractVisibleJobs(dom.window.document, "https://www.zhipin.com/web/geek/jobs");

  assert.equal(jobs.length, 1);
});
