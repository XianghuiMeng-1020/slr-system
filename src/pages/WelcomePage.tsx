import { useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  BookOpen,
  Search,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  FileText,
  Brain,
  Shield,
  LogIn,
} from 'lucide-react'

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  }),
}

const features = [
  {
    icon: FileText,
    title: 'Batch PDF Processing',
    desc: 'Upload up to 50 PDFs or a ZIP archive for systematic analysis in one session.',
  },
  {
    icon: Brain,
    title: 'AI-Powered Coding',
    desc: 'Automatically apply your pre-defined coding scheme to identify themes across literature.',
  },
  {
    icon: Search,
    title: 'Evidence Extraction',
    desc: 'Surface relevant passages that support coding decisions with precise document navigation.',
  },
  {
    icon: Shield,
    title: 'Critical Verification',
    desc: 'Review AI suggestions with full transparency — you retain control of every coding decision.',
  },
]

const steps = [
  { num: '01', label: 'Choose Mode', desc: 'Theme Verification or Evidence Verification' },
  { num: '02', label: 'Upload Documents', desc: 'PDFs, ZIP files, and your coding scheme' },
  { num: '03', label: 'Review & Verify', desc: 'Examine AI suggestions alongside original text' },
  { num: '04', label: 'Export Results', desc: 'Download your verified coding decisions' },
]

export default function WelcomePage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-50 via-white to-primary-50/30">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 glass">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white">
              <BookOpen className="h-5 w-5" />
            </div>
            <span className="font-display text-xl font-bold text-surface-900">
              SLR<span className="text-primary-600">System</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="inline-flex items-center gap-1 text-sm font-medium text-surface-600 hover:text-primary-600 transition-colors">
              <LogIn className="h-4 w-4" /> Login
            </Link>
            <button onClick={() => navigate('/mode')} className="btn-primary text-sm">
              Get Started <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-20 left-1/4 h-72 w-72 rounded-full bg-primary-200/40 blur-3xl" />
          <div className="absolute bottom-10 right-1/4 h-96 w-96 rounded-full bg-accent-200/30 blur-3xl" />
        </div>

        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            custom={0}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-medium text-primary-700"
          >
            <Sparkles className="h-4 w-4" />
            AI-Assisted Systematic Literature Review
          </motion.div>

          <motion.h1
            custom={1}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="font-display text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-surface-900 leading-[1.1]"
          >
            Verify Literature
            <br />
            <span className="bg-gradient-to-r from-primary-600 to-accent-600 bg-clip-text text-transparent">
              With Confidence
            </span>
          </motion.h1>

          <motion.p
            custom={2}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="mx-auto mt-6 max-w-2xl text-lg text-surface-500 leading-relaxed"
          >
            A systematic coding verification platform that combines AI-powered analysis
            with human critical thinking. Upload your papers, apply your coding scheme,
            and verify results with full evidence traceability.
          </motion.p>

          <motion.div
            custom={3}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <button onClick={() => navigate('/mode')} className="btn-primary text-lg px-8 py-4">
              Start Review <ArrowRight className="h-5 w-5" />
            </button>
            <a href="#how-it-works" className="btn-secondary text-lg px-8 py-4">
              How It Works
            </a>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-surface-900">
              Designed for Rigorous Research
            </h2>
            <p className="mt-4 text-surface-500 max-w-2xl mx-auto">
              Every feature is built to support systematic and transparent literature review workflows.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                custom={i}
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                className="card group hover:border-primary-200 hover:shadow-md transition-all duration-300"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 group-hover:bg-primary-100 transition-colors">
                  <f.icon className="h-6 w-6" />
                </div>
                <h3 className="font-display text-lg font-semibold text-surface-900">{f.title}</h3>
                <p className="mt-2 text-sm text-surface-500 leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 px-6 bg-surface-900 text-white">
        <div className="mx-auto max-w-5xl">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="font-display text-3xl sm:text-4xl font-bold">How It Works</h2>
            <p className="mt-4 text-surface-400 max-w-2xl mx-auto">
              Four simple steps from upload to verified results.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {steps.map((s, i) => (
              <motion.div
                key={s.num}
                custom={i}
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                className="relative"
              >
                <span className="font-display text-5xl font-black text-primary-500/20">{s.num}</span>
                <h3 className="mt-2 text-lg font-semibold">{s.label}</h3>
                <p className="mt-1 text-sm text-surface-400">{s.desc}</p>
                {i < steps.length - 1 && (
                  <ArrowRight className="hidden lg:block absolute top-8 -right-5 h-5 w-5 text-surface-600" />
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Two Modes */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-5xl">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-surface-900">
              Two Verification Modes
            </h2>
            <p className="mt-4 text-surface-500 max-w-2xl mx-auto">
              Choose the workflow that best fits your review methodology.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="card border-2 hover:border-primary-300 transition-colors"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-100 text-primary-600 mb-4">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h3 className="font-display text-xl font-bold text-surface-900">Theme Verification</h3>
              <p className="mt-3 text-surface-500 leading-relaxed">
                AI automatically applies your coding scheme to each document.
                Review the suggested labels side-by-side with the original PDF and make adjustments as needed.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-surface-600">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary-500" /> Auto-generated code labels</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary-500" /> Side-by-side PDF view</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary-500" /> Confidence scores</li>
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="card border-2 hover:border-accent-300 transition-colors"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
                <Search className="h-7 w-7" />
              </div>
              <h3 className="font-display text-xl font-bold text-surface-900">Evidence Verification</h3>
              <p className="mt-3 text-surface-500 leading-relaxed">
                AI surfaces relevant evidence passages from the document.
                Click any evidence to jump directly to its location in the PDF.
                Rate whether each piece of evidence supports your coding decision.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-surface-600">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-accent-500" /> Evidence-based review</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-accent-500" /> Click-to-locate in PDF</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-accent-500" /> Yes/No feedback + notes</li>
              </ul>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="mx-auto max-w-3xl rounded-3xl bg-gradient-to-br from-primary-600 to-accent-600 p-12 text-center text-white shadow-2xl"
        >
          <h2 className="font-display text-3xl sm:text-4xl font-bold">Ready to Begin?</h2>
          <p className="mt-4 text-primary-100 max-w-lg mx-auto">
            Start your systematic literature review with AI-assisted coding verification today.
          </p>
          <button
            onClick={() => navigate('/mode')}
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 font-semibold text-primary-700 shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5"
          >
            Get Started <ArrowRight className="h-5 w-5" />
          </button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-surface-200 py-8 px-6 text-center text-sm text-surface-400">
        <p>SLR System — Systematic Literature Review Verification Platform</p>
      </footer>
    </div>
  )
}
