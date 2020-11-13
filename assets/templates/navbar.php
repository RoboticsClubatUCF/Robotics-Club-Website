<?php 
  // This class generates the navbar based on the navbar type desired
  // Created by Alexandra French on 11/12/2020
  // Last updated on 11/13/2020

  class Navbar {
    private $isSized;
  
    // checks if the navbar should be sized, similar to index page
    public function __construct($isSized) {
      $this->isSized = $isSized;
      $this->genNavbar();
    }
    
    // generates the overall navigation bar based on if the navbar should be sized
    private function genNavbar() {
      if (!($this->isSized)) {
        echo "<!-- UCF header -->\n<script type=\"text/javascript\" id=\"ucfhb-script\" src=\"//universityheader.ucf.edu/bar/js/university-header.js\"></script>\n<div id=\"ucfhb\" class=\"fixed-top\"></div>";
      }
      
      echo "\n\n<!-- Navbar -->\n<div class=\"";
      if ($this->isSized) {
        echo "fixed-top";
      } else {
        echo "sticky-top";
      }
      echo "\">";
      echo "\n  <nav class=\"navbar navbar-expand-lg navbar-dark bg-clear text-right\" id=\"navigation bar\">";
      echo "\n    <div class=\"container\">\n      <!-- logo and name -->";
      echo "\n        <a class=\"navbar-brand\" href=\"/\">\n          <div class=\"nav-img\">";
      echo "\n            <img src=\"/assets/imgs/header/roboskull-white.png\" alt=\"club logo white\">";
      echo "\n            <img class=\"overlay\" src=\"/assets/imgs/header/roboskull-gold.png\" alt=\"club logo gold\" loading=\"lazy\">";
      echo "\n            <div class=\"d-none d-md-block\" id=\"nav-logo-text\" aria-label=\"navigation-logo-text\">Robotics Club of Central Florida</div>";
      echo "\n            <div class=\"d-none d-block d-md-none\">&nbsp;</div>\n          </div>\n        </a>";
      echo "\n        <!-- navigation links -->";
      echo "\n      <button class=\"navbar-toggler navbar-toggler-right\" type=\"button\" data-toggle=\"collapse\" data-target=\"#navbarResponsive\" aria-controls=\"navbarResponsive\" aria-expanded=\"false\" aria-label=\"Toggle navigation\">";
      echo "\n        <span class=\"navbar-toggler-icon\"></span>\n      </button>";
      echo "\n      <div class=\"collapse navbar-collapse\" id=\"navbarResponsive\">";
      echo "\n        <ul class=\"navbar-nav ml-auto\">";
      
      // about dropdown
      $this->dropDown("About", array("About Us", "Contact Us", "Constitution"), array("/about/index", "/about/contact", "/about/constitution"));
      
      $this->link("Projects");
      $this->link("Announcements");
      
      // news dropdown
      $this->dropDown("News", array("Newsletter", "Social Media Feed", "News Archive"), array("/news/index", "/news/social-media", "https://us11.campaign-archive.com/home/?u=ba5c2944886feb2964a80fe11&id=e63d752fa6"));
      
      $this->link("Sponsors");
      $this->link("FAQ");
          
      // more dropdown
      echo "\n          <li class=\"nav-item dropdown\">";
      echo "\n            <a class=\"nav-link dropdown-toggle\" href=\"#\" id=\"moreNavbarDropdownPages\" data-toggle=\"dropdown\" aria-haspopup=\"true\" aria-expanded=\"false\">";
      echo "\n              More\n            </a>";
      echo "\n            <div class=\"dropdown-menu dropdown-menu-right\" aria-labelledby=\"moreNavbarDropdownPages\">";
      echo "\n              <a class=\"dropdown-item\" href=\"/more/gallery\">Photo Gallery</a>";
      echo "\n              <div id=\"theme-toggle\">";
      echo "\n                <label for=\"toggle-dark\">Dark Mode";
      echo "\n                <div class=\"switch\">\n                  <input type=\"checkbox\" id=\"toggle-dark\">";
      echo "\n                  <div class=\"slider round\" id=\"switch-toggle\"></div>";
      echo "\n                </div>\n                </label>";
      echo "\n              </div>\n            </div>\n          </li>";
      echo "\n        </ul>\n      </div>\n    </div>\n  </nav>\n</div>\n<!-- /.navbar -->";
    }
    
    // generates a link using only its name
    private function link($name) {
      echo "\n          <li class=\"nav-item\">";
      echo "\n            <a class=\"nav-link\" href=\"/" . strtolower($name) . "/index\">" . $name . "</a>";
      echo "\n          </li>";
    }
    
    
    // generates a dropdown using the type and an array of names and links.
    private function dropDown($type, $names, $links) {
      echo "\n          <li class=\"nav-item dropdown\">";
      echo "\n            <a class=\"nav-link dropdown-toggle\" href=\"#\" id=\"" . strtolower($type);
      echo "NavbarDropdownPages\" data-toggle=\"dropdown\" aria-haspopup=\"true\" aria-expanded=\"false\">";
      echo "\n              " . $type . "\n            </a>";
      echo "\n            <div class=\"dropdown-menu dropdown-menu-right\" aria-labelledby=\"";
      echo $type . "NavbarDropdownPages\">";
      // get each page in the dropdown
      for ($num = 0; $num < count($names); $num++) {
        echo "\n              <a class=\"dropdown-item\" href=\"" . $links[$num] . "\">" . $names[$num] . "</a>";
      }
      echo "\n            </div>\n          </li>";
    }
  }


?>