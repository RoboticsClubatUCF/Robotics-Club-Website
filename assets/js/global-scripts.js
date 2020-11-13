const prefersDarkScheme=window.matchMedia("(prefers-color-scheme: dark)");const currentTheme=localStorage.getItem("theme");if(currentTheme=="dark"||currentTheme==null&&prefersDarkScheme.matches){document.body.classList.toggle("dark");document.getElementById('switch-toggle').classList.toggle("on");}else{document.body.classList.remove("dark");document.getElementById('switch-toggle').classList.remove("on");}
const themeToggle=document.getElementById('toggle-dark');themeToggle.addEventListener("click",function(){if(prefersDarkScheme.matches){var theme=document.body.classList.contains("dark")?"light":"dark";if(theme=="dark"){document.body.classList.toggle("dark");document.getElementById('switch-toggle').classList.toggle("on");}else{document.body.classList.remove("dark");document.getElementById('switch-toggle').classList.remove("on");}}else{var theme=document.body.classList.contains("dark")?"dark":"light";if(theme=="light"){document.body.classList.toggle("dark");document.getElementById('switch-toggle').classList.toggle("on");theme="dark";}else{document.body.classList.remove("dark");document.getElementById('switch-toggle').classList.remove("on");theme="light";}}
localStorage.setItem("theme",theme);});function isPartiallyInView(el){var windowWidth=Math.max(document.documentElement.clientWidth,window.innerWidth||0);var windowHeight=Math.max(document.documentElement.clientHeight,window.innerHeight||0);return((el.getBoundingClientRect().top+el.clientHeight>0&&el.getBoundingClientRect().top<windowHeight)&&(el.getBoundingClientRect().left+el.clientWidth>0&&el.getBoundingClientRect().left<windowWidth));}
function setVisibleSlides(i,el){if(isPartiallyInView(el)){$(el).addClass("no-slide");}}
function setInvisibleSlides(i,el){if(isPartiallyInView(el)){$(el).addClass("slide-in");}}
function animateSlideIn(event){$(".slide-child").each(setInvisibleSlides);}
$(".slide-child").each(setVisibleSlides);$(window).scroll(animateSlideIn);