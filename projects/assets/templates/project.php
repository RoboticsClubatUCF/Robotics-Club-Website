<?php
  // This class can generate a project block for the projects page
  // Created Nov 4 by Alexandra French
  // Last updated Nov 4 by Alexandra French

  class Project {
    private $number;

    // Uses a counter to keep track of each announcement for color swapping
    public function __construct() {
      $this->number = 1;
    }
    
    // generates a project block and a line afterwards.
    // buttonText and buttonLink are optional parameters.
    public function generate($title, $image, $imageAlt, $description, $buttonText, $buttonLink) {
      echo "    <!-- Project " . $this->number . " -->
    <div class=\"row align-items-center justify-content-center\">\n      ";
      echo "<div class=\"col-md-7 p-1 ";
      if ($this->number%2 == 1){
        echo "project-body-gray-gold";
      }
      echo "\">\n        ";
      echo "<img class=\"img-fluid rounded mb-3 mb-md-0\" src=\"" . $image . "\" alt=\"". $imageAlt . "\">\n      ";
      echo "</div>\n      ";
      echo "<div class=\"col-md-5 p-2 ";
      if ($this->number%2 == 1) {
        echo "border project-body-creame-black";
      } else {
        echo "project-body-gray-gold";
      }
      echo "\">\n        ";
      echo "<h3>" . $title . "</h3>\n        ";
      echo "<p>" . $description . "</p>\n        ";
      echo "<br>\n        ";
      if ($buttonText != null){
        echo "<a class=\"btn ";
        if ($this->number%2 == 1) {
          echo "btn-dark";
        } else {
          echo "btn-light";
        }
        echo "\" href=\"" . $buttonLink . "\">" . $buttonText . "</a>\n      ";
      }
      echo "</div>
    </div>";
      echo "\n  <!-- /.project " . $this->number . " -->\n  ";
      echo "<hr>\n  ";
      
      $this->number += 1;
    }
    
  }

?>
