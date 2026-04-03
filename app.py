"""
BARITA WEALTH ADVISOR — app.py (Flask Backend)
OpenAI GPT-4o integration
"""

import os, io, json
from datetime import datetime

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from openai import OpenAI
import firebase_admin
from firebase_admin import credentials, auth as fb_auth, firestore
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from dotenv import load_dotenv
load_dotenv()

# ── CONFIG ────────────────────────────────────────────────────────────────────
OPENAI_API_KEY           = os.environ.get("OPENAI_API_KEY", "")
FIREBASE_SERVICE_ACCOUNT = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "")

app = Flask(__name__, static_folder="public", static_url_path="")
CORS(app, origins=["*"])

# ── FIREBASE ──────────────────────────────────────────────────────────────────
if FIREBASE_SERVICE_ACCOUNT:
    cred = credentials.Certificate(json.loads(FIREBASE_SERVICE_ACCOUNT))
else:
    cred = credentials.Certificate("serviceAccountKey.json")

firebase_admin.initialize_app(cred)
db = firestore.client()

# ── OPENAI ────────────────────────────────────────────────────────────────────
client = OpenAI(api_key=OPENAI_API_KEY)

# ── AUTH ──────────────────────────────────────────────────────────────────────
def verify_token(req):
    header = req.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None, "Missing token"
    try:
        return fb_auth.verify_id_token(header.split("Bearer ")[1]), None
    except Exception as e:
        return None, str(e)

# ── PORTFOLIO ENGINE ──────────────────────────────────────────────────────────
def score_answers(answers):
    score = 0

    # Knowledge level (0-3)
    knowledge_map = {
        "I'm completely new to investing": 0,
        "I have basic knowledge but no real experience": 1,
        "I've been learning and have some experience": 2,
        "I have a lot of investing experience": 3,
    }
    score += knowledge_map.get(answers.get("knowledge_level", ""), 1)

    # Drop reaction (0-3)
    drop_map = {
        "Sell everything to avoid further losses": 0,
        "Sell some to reduce losses": 1,
        "Wait for recovery": 2,
        "Invest more at lower prices": 3,
    }
    score += drop_map.get(answers.get("drop_reaction", ""), 1)

    # Risk relationship (0-3)
    risk_map = {
        "I worry a lot about losing money": 0,
        "I'm okay with small changes, but big losses stress me": 1,
        "I understand ups and downs and stay calm": 2,
        "I'm comfortable with big risks and see drops as opportunities": 3,
    }
    score += risk_map.get(answers.get("risk_relationship", ""), 1)

    # Loss vs gain (0-1)
    score += 0 if answers.get("loss_vs_gain") == "Suffering a 20% loss" else 1

    # Max loss tolerance (0-3)
    loss_map = {"Up to 10%": 0, "Up to 20%": 1, "Up to 40%": 2, "More than 40%": 3}
    score += loss_map.get(answers.get("max_loss", "Up to 20%"), 1)

    # Income runway (0-4)
    runway_map = {"Less than 3 months": 0, "3-6 months": 1, "6-12 months": 2, "1-2 years": 3, "More than 2 years": 4}
    score += runway_map.get(answers.get("income_loss_runway", ""), 2)

    # Debt situation (0-3)
    debt_map = {"Significant debt": 0, "Moderate debt": 1, "Minor debt": 2, "Debt-free": 3}
    score += debt_map.get(answers.get("debt_situation", ""), 1)

    # Withdrawal plan (0-3)
    withdraw_map = {"More than 25%": 0, "10-25%": 1, "Less than 10%": 2, "No withdrawals": 3}
    score += withdraw_map.get(answers.get("withdrawal_time", ""), 2)

    # Investment style (0-4)
    style_map = {"Fully passive": 0, "Mostly passive": 1, "Balanced": 2, "Mostly active": 3, "Fully active": 4}
    score += style_map.get(answers.get("invest_style", ""), 2)

    # Market adjustment (0-3)
    adjust_map = {"No - keep it fixed": 0, "Yes - small changes": 1, "Yes - moderate changes": 2, "Yes - fully active": 3}
    score += adjust_map.get(answers.get("market_adjustment", ""), 1)

    # Max possible ~ 30
    pct = score / 30.0
    if pct < 0.35:   profile, label = "Conservative", "Beginner Investor"
    elif pct < 0.65: profile, label = "Moderate",     "Intermediate Investor"
    else:            profile, label = "Aggressive",   "Experienced Investor"

    exp_level = knowledge_map.get(answers.get("knowledge_level", ""), 1)
    exp_label = "Beginner" if exp_level <= 1 else ("Experienced" if exp_level == 3 else "Intermediate")
    return score, profile, label, exp_label

def build_allocation(profile, answers):
    avoid = answers.get("avoid_assets", [])
    if profile == "Conservative":
        raw = [
            {"label":"JMD T-Bills",        "ticker":"TBILLJMD",      "pct":25,"color":"#10B981","class":"Cash"},
            {"label":"USD T-Bills",         "ticker":"TBILLUSD",      "pct":15,"color":"#6EE7B7","class":"Cash"},
            {"label":"Short Gov Bonds",     "ticker":"PVAU / CWPU",   "pct":25,"color":"#0BB8A9","class":"Fixed Income"},
            {"label":"Long Gov Bonds",      "ticker":"JFG / QPESE",   "pct":20,"color":"#38BDF8","class":"Fixed Income"},
            {"label":"Real Estate Fund",    "ticker":"XEAK",          "pct":10,"color":"#FB923C","class":"Real Estate"},
            {"label":"Domestic Defensives", "ticker":"PDTOU / XPMCJ", "pct":5, "color":"#A78BFA","class":"Equity"},
        ]
        breakdown = {"Fixed Income":{"pct":45,"color":"#0BB8A9"},"Cash & MM":{"pct":40,"color":"#10B981"},"Real Estate":{"pct":10,"color":"#FB923C"},"Equity":{"pct":5,"color":"#A78BFA"}}
        metrics   = {"expected_return":"7.4%","volatility":"4.2%","sharpe_ratio":"1.41"}
    elif profile == "Moderate":
        raw = [
            {"label":"Short Gov Bonds",     "ticker":"PVAU / CWPU",  "pct":18,"color":"#0BB8A9","class":"Fixed Income"},
            {"label":"Long Gov Bonds",      "ticker":"JFG / QPESE",  "pct":12,"color":"#38BDF8","class":"Fixed Income"},
            {"label":"Corporate Bonds",     "ticker":"IRKXL / DTOT", "pct":10,"color":"#FBBF24","class":"Fixed Income"},
            {"label":"Domestic Financials", "ticker":"XKFZ / KBJZN","pct":15,"color":"#3B82F6","class":"Equity"},
            {"label":"Domestic Defensives", "ticker":"PDTOU / XPMCJ","pct":15,"color":"#8B5CF6","class":"Equity"},
            {"label":"Global Tech Equity",  "ticker":"WBG / MOSWO",  "pct":15,"color":"#EC4899","class":"Equity"},
            {"label":"Real Estate Fund",    "ticker":"XEAK",         "pct":10,"color":"#FB923C","class":"Real Estate"},
            {"label":"Alt Investments",     "ticker":"IGRIG",        "pct":5, "color":"#6B7280","class":"Alternatives"},
        ]
        breakdown = {"Fixed Income":{"pct":40,"color":"#0BB8A9"},"Equity":{"pct":45,"color":"#3B82F6"},"Real Estate":{"pct":10,"color":"#FB923C"},"Alternatives":{"pct":5,"color":"#6B7280"}}
        metrics   = {"expected_return":"11.8%","volatility":"9.6%","sharpe_ratio":"0.97"}
    else:
        raw = [
            {"label":"Domestic Financials","ticker":"XKFZ / KBJZN / TIHE","pct":18,"color":"#3B82F6","class":"Equity"},
            {"label":"Domestic Cyclicals", "ticker":"MBTTD / YTR / IZQLN","pct":14,"color":"#EF4444","class":"Equity"},
            {"label":"Global Tech Equity", "ticker":"WBG / MOSWO / RJK",  "pct":20,"color":"#8B5CF6","class":"Equity"},
            {"label":"Emerging Markets",   "ticker":"BQB / EMWB / CQOAC", "pct":15,"color":"#06B6D4","class":"Equity"},
            {"label":"Corporate Bonds",    "ticker":"IRKXL / DTOT",       "pct":12,"color":"#FBBF24","class":"Fixed Income"},
            {"label":"Real Estate Fund",   "ticker":"XEAK",               "pct":10,"color":"#FB923C","class":"Real Estate"},
            {"label":"Alt Investments",    "ticker":"IGRIG",              "pct":8, "color":"#6B7280","class":"Alternatives"},
            {"label":"JMD T-Bills",        "ticker":"TBILLJMD",           "pct":3, "color":"#10B981","class":"Cash"},
        ]
        breakdown = {"Equity":{"pct":67,"color":"#3B82F6"},"Fixed Income":{"pct":12,"color":"#0BB8A9"},"Alternatives":{"pct":18,"color":"#6B7280"},"Cash":{"pct":3,"color":"#10B981"}}
        metrics   = {"expected_return":"17.3%","volatility":"16.8%","sharpe_ratio":"0.88"}

    avoid_map = {"Equities (Stocks)":"Equity","Fixed Income (Bonds)":"Fixed Income","Real Estate":"Real Estate","Commodities":"Commodities","Cash and Cash Equivalents":"Cash","Alternative Investments":"Alternatives"}
    avoid_classes = [avoid_map[a] for a in avoid if a in avoid_map]
    filtered = [a for a in raw if a["class"] not in avoid_classes] or raw
    total = sum(a["pct"] for a in filtered)
    for a in filtered: a["pct"] = round(a["pct"] / total * 100)
    diff = 100 - sum(a["pct"] for a in filtered)
    if filtered and diff != 0: filtered[0]["pct"] += diff
    return filtered, breakdown, metrics

def system_prompt(answers, report):
    allocs = report.get("allocations", [])
    m      = report.get("metrics", {})
    return f"""You are a professional Jamaican investment advisor for Barita Investments Limited (Barita SOC 2026).
Client risk profile: {report.get('profile','Moderate')} — {report.get('profile_label','')}
Goals: {', '.join(answers.get('objectives',[]))} | Horizon: {answers.get('withdrawal_time','')} | Amount: JMD {answers.get('investable_amount','')}
Portfolio: {' | '.join(f"{a['label']} {a['pct']}%" for a in allocs)}
Metrics: Return {m.get('expected_return','—')} | Vol {m.get('volatility','—')} | Sharpe {m.get('sharpe_ratio','—')}
Be warm, professional, concise (150-250 words). Reference Jamaican market context. Flowing paragraphs only, no bullet points."""

# ── ROUTES ────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return send_file("public/landing.html")

@app.route("/app")
def dashboard():
    return send_file("public/index.html")

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "Barita Wealth Advisor API — GPT-4o"})

@app.route("/analyse", methods=["POST"])
def analyse():
    user, err = verify_token(request)
    if err: return jsonify({"error": err}), 401

    answers = request.get_json().get("answers", {})
    score, profile, profile_label, exp_level = score_answers(answers)
    allocations, risk_breakdown, metrics = build_allocation(profile, answers)

    advisory = ""
    try:
        goals     = ', '.join(answers.get('objectives', []))
        horizon   = answers.get('withdrawal_time', '')
        amount    = answers.get('investable_amount', '')
        port_str  = ', '.join(a['label'] + ' ' + str(a['pct']) + '%' for a in allocations)
        adv_prompt = (
            f"Write a personalised advisory note (200-280 words, flowing paragraphs, no headers) "
            f"for a {profile} investor.\n"
            f"Goals: {goals}\nHorizon: {horizon}\nAmount: JMD {amount}\n"
            f"Portfolio: {port_str}\n"
            f"Return: {metrics['expected_return']} | Vol: {metrics['volatility']} | Sharpe: {metrics['sharpe_ratio']}\n"
            f"Be warm, professional, Jamaica-specific."
        )
        resp = client.chat.completions.create(
            model="gpt-4o", max_tokens=600,
            messages=[
                {"role": "system", "content": "You are a professional Jamaican investment advisor for Barita Investments."},
                {"role": "user",   "content": adv_prompt},
            ],
        )
        advisory = resp.choices[0].message.content
    except Exception as e:
        advisory = f"Portfolio built successfully. Advisory unavailable: {e}"

    result = {"profile":profile,"profile_label":profile_label,"exp_level":exp_level,"score":score,"allocations":allocations,"risk_breakdown":risk_breakdown,"metrics":metrics,"advisory_note":advisory}

    try:
        db.collection("sessions").document(user["uid"]).set({"answers":answers,"report":{k:v for k,v in result.items() if k!="allocations"},"allocations":allocations,"updated_at":firestore.SERVER_TIMESTAMP})
    except Exception as e:
        print(f"Firestore error: {e}")

    return jsonify(result)

@app.route("/chat", methods=["POST"])
def chat():
    user, err = verify_token(request)
    if err: return jsonify({"error": err}), 401

    data    = request.get_json()
    message = data.get("message","")
    answers = data.get("answers",{})
    report  = data.get("report",{})
    history = data.get("history",[])

    messages = [{"role":"system","content":system_prompt(answers, report)}]
    for h in history[-8:]:
        if h.get("role") == "user":    messages.append({"role":"user",      "content":h["text"]})
        elif h.get("role") == "advisor" and h.get("text"): messages.append({"role":"assistant","content":h["text"]})
    messages.append({"role":"user","content":message})

    try:
        resp  = client.chat.completions.create(model="gpt-4o", max_tokens=600, messages=messages)
        reply = resp.choices[0].message.content
    except Exception as e:
        reply = f"Sorry, I encountered an error: {e}"

    return jsonify({"reply": reply})

@app.route("/generate_report", methods=["POST"])
def generate_report():
    user, err = verify_token(request)
    if err: return jsonify({"error": err}), 401

    data    = request.get_json()
    answers = data.get("answers",{})
    report  = data.get("report",{})

    if not report or not report.get("allocations"):
        _, profile, profile_label, _ = score_answers(answers)
        allocs, rb, metrics = build_allocation(profile, answers)
        report = {"profile":profile,"profile_label":profile_label,"allocations":allocs,"risk_breakdown":rb,"metrics":metrics,"advisory_note":""}

    pdf = build_pdf(user, answers, report)
    return send_file(io.BytesIO(pdf), mimetype="application/pdf", as_attachment=True,
                     download_name=f"Barita_Report_{datetime.now().strftime('%Y%m%d')}.pdf")

def build_pdf(user_info, answers, report):
    buf   = io.BytesIO()
    doc   = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    story = []
    TEAL  = colors.HexColor("#0BB8A9")
    NAVY  = colors.HexColor("#1A2342")
    LIGHT = colors.HexColor("#F0F4F8")
    BORD  = colors.HexColor("#E4E9F0")
    GREEN = colors.HexColor("#10B981")
    RED   = colors.HexColor("#EF4444")
    MUTED = colors.HexColor("#6B7A99")
    body  = ParagraphStyle("b", fontName="Helvetica",      fontSize=10, textColor=NAVY,  leading=15, spaceAfter=6)
    h2    = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=13, textColor=NAVY,  spaceBefore=14, spaceAfter=6)
    sm    = ParagraphStyle("s", fontName="Helvetica",      fontSize=9,  textColor=MUTED, leading=13)

    profile    = report.get("profile","Moderate")
    metrics    = report.get("metrics",{})
    allocations= report.get("allocations",[])
    advisory   = report.get("advisory_note","")
    name       = user_info.get("name","Client")
    email      = user_info.get("email","")

    hdr = Table([[
        Paragraph("BARITA INVESTMENTS LIMITED", ParagraphStyle("hh", fontName="Helvetica-Bold", fontSize=14, textColor=colors.white)),
        Paragraph(f"Portfolio Report<br/>{datetime.now().strftime('%B %d, %Y')}", ParagraphStyle("hs", fontName="Helvetica", fontSize=9, textColor=colors.white, alignment=TA_RIGHT)),
    ]], colWidths=["70%","30%"])
    hdr.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),NAVY),("PADDING",(0,0),(-1,-1),12),("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
    story += [hdr, Spacer(1,12), Paragraph(f"Prepared for: <b>{name}</b> | {email}", body), HRFlowable(width="100%",thickness=1,color=BORD), Spacer(1,10)]

    story.append(Paragraph("Investor Profile", h2))
    pt = Table([
        ["Risk Profile", profile, "Level", report.get("profile_label","")],
        ["Goals", ", ".join(answers.get("objectives",["—"])), "Horizon", answers.get("withdrawal_time","—")],
        ["Amount", f"JMD {answers.get('investable_amount','—')}", "Currency", answers.get("primary_currency","—")],
    ], colWidths=["20%","30%","20%","30%"])
    pt.setStyle(TableStyle([("FONTNAME",(0,0),(-1,-1),"Helvetica"),("FONTSIZE",(0,0),(-1,-1),9),("FONTNAME",(0,0),(0,-1),"Helvetica-Bold"),("FONTNAME",(2,0),(2,-1),"Helvetica-Bold"),("TEXTCOLOR",(0,0),(0,-1),MUTED),("TEXTCOLOR",(2,0),(2,-1),MUTED),("ROWBACKGROUNDS",(0,0),(-1,-1),[LIGHT,colors.white]),("PADDING",(0,0),(-1,-1),8),("GRID",(0,0),(-1,-1),0.5,BORD),("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
    story += [pt, Spacer(1,12)]

    story.append(Paragraph("Portfolio Metrics", h2))
    mt = Table([["Expected Return","Annualised Volatility","Sharpe Ratio"],[metrics.get("expected_return","—"),metrics.get("volatility","—"),metrics.get("sharpe_ratio","—")]], colWidths=["33%","33%","34%"])
    mt.setStyle(TableStyle([("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("FONTSIZE",(0,0),(-1,0),9),("FONTSIZE",(0,1),(-1,1),18),("FONTNAME",(0,1),(-1,1),"Helvetica-Bold"),("TEXTCOLOR",(0,0),(-1,0),MUTED),("TEXTCOLOR",(0,1),(0,1),GREEN),("TEXTCOLOR",(1,1),(1,1),RED),("TEXTCOLOR",(2,1),(2,1),TEAL),("BACKGROUND",(0,0),(-1,-1),LIGHT),("ALIGN",(0,0),(-1,-1),"CENTER"),("VALIGN",(0,0),(-1,-1),"MIDDLE"),("PADDING",(0,0),(-1,-1),12),("GRID",(0,0),(-1,-1),0.5,BORD)]))
    story += [mt, Spacer(1,12)]

    story.append(Paragraph("Asset Allocation", h2))
    ar = [[Paragraph(x, ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=9, textColor=MUTED)) for x in ["Instrument","Ticker(s)","Class","Weight"]]]
    for a in allocations:
        ar.append([Paragraph(a["label"], ParagraphStyle("ac", fontName="Helvetica-Bold", fontSize=9, textColor=NAVY)), Paragraph(a["ticker"], ParagraphStyle("at", fontName="Helvetica", fontSize=8, textColor=MUTED)), Paragraph(a.get("class",""), ParagraphStyle("ac2", fontName="Helvetica", fontSize=9, textColor=NAVY)), Paragraph(f"<b>{a['pct']}%</b>", ParagraphStyle("ap", fontName="Helvetica-Bold", fontSize=10, textColor=TEAL, alignment=TA_RIGHT))])
    at = Table(ar, colWidths=["35%","30%","20%","15%"])
    at.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY),("ROWBACKGROUNDS",(0,1),(-1,-1),[LIGHT,colors.white]),("GRID",(0,0),(-1,-1),0.5,BORD),("PADDING",(0,0),(-1,-1),8),("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
    story += [at, Spacer(1,12)]

    if advisory:
        story += [Paragraph("Advisor Commentary", h2), HRFlowable(width="100%",thickness=1.5,color=TEAL), Spacer(1,8)]
        for para in advisory.split("\n\n"):
            if para.strip(): story.append(Paragraph(para.strip(), body))

    story += [Spacer(1,8), HRFlowable(width="100%",thickness=0.5,color=BORD), Spacer(1,6),
              Paragraph("This report was generated for the Barita SOC 2026 using synthetic data by Dimension Depths. Not real financial advice. © 2026 Barita Investments Limited.", sm)]

    doc.build(story)
    return buf.getvalue()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT",5000)), debug=False)