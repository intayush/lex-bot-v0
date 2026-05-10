import { inferSectionType } from './section-type.js';

describe('inferSectionType', () => {
  describe('URL-based classification', () => {
    it('classifies practice-area URLs', () => {
      expect(inferSectionType('https://example.com/practice-areas/criminal-defense', '', '')).toBe('practice-area');
      expect(inferSectionType('https://example.com/services/family-law', '', '')).toBe('practice-area');
      expect(inferSectionType('https://example.com/area-of-law/dui', '', '')).toBe('practice-area');
    });

    it('classifies attorney-bio URLs', () => {
      expect(inferSectionType('https://example.com/attorneys/john-smith', '', '')).toBe('attorney-bio');
      expect(inferSectionType('https://example.com/lawyer/jane-doe', '', '')).toBe('attorney-bio');
      expect(inferSectionType('https://example.com/team/partners', '', '')).toBe('attorney-bio');
      expect(inferSectionType('https://example.com/staff/paralegals', '', '')).toBe('attorney-bio');
      expect(inferSectionType('https://example.com/bio/maria-garcia', '', '')).toBe('attorney-bio');
    });

    it('classifies FAQ URLs', () => {
      expect(inferSectionType('https://example.com/faq', '', '')).toBe('faq');
      expect(inferSectionType('https://example.com/frequently-asked-questions', '', '')).toBe('faq');
    });

    it('classifies blog URLs', () => {
      expect(inferSectionType('https://example.com/blog/recent-case', '', '')).toBe('blog-post');
      expect(inferSectionType('https://example.com/news/update', '', '')).toBe('blog-post');
      expect(inferSectionType('https://example.com/articles/dui-laws', '', '')).toBe('blog-post');
      expect(inferSectionType('https://example.com/posts/2024', '', '')).toBe('blog-post');
    });

    it('classifies contact URLs', () => {
      expect(inferSectionType('https://example.com/contact', '', '')).toBe('contact');
      expect(inferSectionType('https://example.com/locations/pittsburgh', '', '')).toBe('contact');
      expect(inferSectionType('https://example.com/office-hours', '', '')).toBe('contact');
    });

    it('classifies about URLs', () => {
      expect(inferSectionType('https://example.com/about', '', '')).toBe('about');
      expect(inferSectionType('https://example.com/about-us', '', '')).toBe('about');
      expect(inferSectionType('https://example.com/firm/overview', '', '')).toBe('about');
      expect(inferSectionType('https://example.com/history', '', '')).toBe('about');
      expect(inferSectionType('https://example.com/mission', '', '')).toBe('about');
    });

    it('URL patterns take priority over content hints', () => {
      // Even if the title says "FAQ", a practice-area URL wins
      expect(inferSectionType('https://example.com/practice-areas/faq', 'FAQ', '')).toBe('practice-area');
    });
  });

  describe('content-based classification', () => {
    const neutralUrl = 'https://example.com/page';

    it('classifies FAQ by title', () => {
      expect(inferSectionType(neutralUrl, 'Frequently Asked Questions', '')).toBe('faq');
      expect(inferSectionType(neutralUrl, 'FAQ - Common Questions', '')).toBe('faq');
      expect(inferSectionType(neutralUrl, 'Common Questions About Our Services', '')).toBe('faq');
    });

    it('classifies contact by title', () => {
      expect(inferSectionType(neutralUrl, 'Contact Us', '')).toBe('contact');
      expect(inferSectionType(neutralUrl, 'Get In Touch', '')).toBe('contact');
      expect(inferSectionType(neutralUrl, 'Office Hours and Location', '')).toBe('contact');
    });

    it('classifies about by title', () => {
      expect(inferSectionType(neutralUrl, 'About Our Firm', '')).toBe('about');
      expect(inferSectionType(neutralUrl, 'Our History', '')).toBe('about');
      expect(inferSectionType(neutralUrl, 'Who We Are', '')).toBe('about');
    });

    it('classifies blog by title', () => {
      expect(inferSectionType(neutralUrl, 'Blog - Latest Updates', '')).toBe('blog-post');
      expect(inferSectionType(neutralUrl, 'News and Articles', '')).toBe('blog-post');
    });

    it('classifies attorney-bio by bio content markers', () => {
      expect(
        inferSectionType(neutralUrl, 'Maria Garcia', 'Education: J.D., Northwestern University. Bar Admissions: Pennsylvania.')
      ).toBe('attorney-bio');
    });

    it('classifies attorney-bio by explicit bio title words', () => {
      expect(inferSectionType(neutralUrl, 'Attorney Bio - John Smith', '')).toBe('attorney-bio');
      expect(inferSectionType(neutralUrl, 'Partner Profile', '')).toBe('attorney-bio');
      expect(inferSectionType(neutralUrl, 'Senior Associate Details', '')).toBe('attorney-bio');
      expect(inferSectionType(neutralUrl, 'Of Counsel Members', '')).toBe('attorney-bio');
    });

    it('classifies practice-area by legal topic titles', () => {
      expect(inferSectionType(neutralUrl, 'Criminal Defense', '')).toBe('practice-area');
      expect(inferSectionType(neutralUrl, 'Personal Injury', '')).toBe('practice-area');
      expect(inferSectionType(neutralUrl, 'Family Law Services', '')).toBe('practice-area');
      expect(inferSectionType(neutralUrl, 'DUI Defense', '')).toBe('practice-area');
      expect(inferSectionType(neutralUrl, 'Immigration Services', '')).toBe('practice-area');
    });

    describe('regression cases', () => {
      it('"Pittsburgh DUI Attorney" should be practice-area, not attorney-bio', () => {
        expect(inferSectionType(neutralUrl, 'Pittsburgh DUI Attorney', '')).toBe('practice-area');
      });

      it('"Demo Law Firm - Home" should be general', () => {
        expect(inferSectionType(neutralUrl, 'Demo Law Firm - Home', '')).toBe('general');
      });

      it('person name with bio content should be attorney-bio', () => {
        const content = 'Maria Garcia received her J.D. from Northwestern University. Education includes undergraduate work at Penn State. Bar Admissions: PA, NY.';
        expect(inferSectionType(neutralUrl, 'Maria Garcia', content)).toBe('attorney-bio');
      });
    });

    it('returns general for pages with no signals', () => {
      expect(inferSectionType(neutralUrl, 'Welcome', '')).toBe('general');
      expect(inferSectionType(neutralUrl, 'Home Page', '')).toBe('general');
      expect(inferSectionType(neutralUrl, '', '')).toBe('general');
    });
  });
});
