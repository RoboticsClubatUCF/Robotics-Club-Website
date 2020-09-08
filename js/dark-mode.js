/* Dark mode for the webpage
Created by: Alexandra French
For: the Robotics Club of Central Florida
On: August 11, 2020

Last modified on: August 11, 2020
By: Alexandra French
*/

// Check for dark mode preference at the OS and local storage levels
const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");
const currentTheme = localStorage.getItem("theme");

// If the user's preference is darkmode, toggle darkmode
// otherwise remove darkmode
if (currentTheme == "dark" || currentTheme == null && prefersDarkScheme.matches) {
  document.body.classList.toggle("dark");
  document.getElementById('switch-toggle').classList.toggle("on");
} else {
  document.body.classList.remove("dark");
  document.getElementById('switch-toggle').classList.remove("on");
}


// when the darkmode button is clicked
const themeToggle = document.getElementById('toggle-dark');
themeToggle.addEventListener("click", function() {
  // if os setting is dark mode, set it as light mode, otherwise set as darkmode
  if (prefersDarkScheme.matches) {
    // if contains darkmode already, set it as light mode
    // otherwise set it to darkmode
    var theme = document.body.classList.contains("dark") ? "light" : "dark";

    // if dark, toggle dark. otherwise, vice versa
    if (theme == "dark") {
      document.body.classList.toggle("dark");
      document.getElementById('switch-toggle').classList.toggle("on");
    } else {
      document.body.classList.remove("dark");
      document.getElementById('switch-toggle').classList.remove("on");
    }
  } else {
    // get the current theme
    var theme = document.body.classList.contains("dark") ? "dark" : "light";

    // if lightmode, toggle darkmode. otherwise, vice versa
    if (theme == "light") {
      document.body.classList.toggle("dark");
      document.getElementById('switch-toggle').classList.toggle("on");
      theme = "dark";
    } else {
      document.body.classList.remove("dark");
      document.getElementById('switch-toggle').classList.remove("on");
      theme = "light";
    }
  }

  // save the theme to local storage
  localStorage.setItem("theme", theme);
});
