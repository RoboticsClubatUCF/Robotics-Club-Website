<?php

  // This class can generate a variety of slideshows for a page
  // Created Nov 5 by Alexandra French
  // Last updated Nov 5 by Alexandra French

  class Slideshows {
  
    public function __construct() {
    }
    
    // generates a wide slideshow. Requires number of slides, an array of images, and an array of slide captions
    public function generateWideSlideshow ($numSlides, $images, $captions) {
      echo "<!-- slideshow -->
      <div id=\"wide-carousel\" class=\"carousel slide\" data-ride=\"carousel\" data-interval=\"false\">
        <ol class=\"carousel-indicators\">";
      $slide = 0;
      // echo an indicator for each slide
      while($slide < $numSlides) {
        echo "<li data-target=\"#wide-carousel\" data-slide-to=\"" . $slide . "\"";
        if ($slide == 0) {
          echo " class=\"active\"";
        }
        echo "></li>";
        $slide += 1;
      }
      echo "\n        </ol>
      <div class=\"carousel-inner\" role=\"listbox\">";
      $slide = 0;
      // echo each slides image and caption
      while ($slide < $numSlides) {
        echo "          <!-- Slide" . $slide . " -->";
        echo "\n          <div class=\"carousel-item";
        if ($slide == 0) {
          echo " active";
        } 
        echo "\" style=\"background-image: url('" . $images[$slide] . "')\">";
        echo "<div class=\"carousel-caption d-none d-md-block\">\n";
        if ($slide == 0){
          echo "\n              <h1>";
        } else {
          echo "\n              <h2>";
        }
        echo $captions[$slide];
        if ($slide == 0) {
          echo "</h1>";
        } else {
          echo "</h2>";
        } 
        echo "\n            </div>";
        echo "\n          </div>";
        $slide += 1;
      }
      echo"\n        </div>";
      echo "\n      <a class=\"carousel-control-prev\" href=\"#wide-carousel\" role=\"button\" data-slide=\"prev\">
          <span class=\"carousel-control-prev-icon\" aria-hidden=\"true\"></span>
          <span class=\"sr-only\">Previous</span>
        </a>
        <a class=\"carousel-control-next\" href=\"#wide-carousel\" role=\"button\" data-slide=\"next\">
          <span class=\"carousel-control-next-icon\" aria-hidden=\"true\"></span>
          <span class=\"sr-only\">Next</span>
        </a>
      </div>
      <!-- /.slide show -->";
      
    }

    // generates a circular slideshow of 3 images, with the central image larger than the 2 edge images
    // requires an array of images, an array of titles, and an array of captions.
    public function generateCircleSlideshow($images, $titles, $captions) {
      echo "<!-- slides -->
          <div id=\"circle-carousel\" class=\"carousel slide d-flex align-items-center justify-content-center\" data-ride=\"carousel\" data-interval=\"false\" data-touch=\"false\">
            <div class=\"carousel-inner align-items-center justify-content-center\" role=\"listbox\">";
      
      $slide = 0;
      // print out each individual circular slide
      while ($slide < 3) {
        echo "\n              <!-- slide " . ($slide+1) . " -->";
      
        echo "\n              <div class=\"carousel-item robo-item ";
        if ($slide == 0){
          echo "active ";
        }
        echo "small-1 justify-content-center align-content-center\">";
        echo "\n                <div class=\"card text-center card-clear circle-card-" . $slide . " justify-self-center align-self-center\">";
        echo "\n                  <!-- overlay container -->
                  <div class=\"overlay-container\">";
        echo "\n                    <img class=\"card-img rounded-circle img-fluid\" src=\"" . $images[$slide] . "\" alt=\"" . $titles[$slide] . "\">";
        echo "\n                    <div class=\"card-img-overlay rounded-circle\">
                      <div class=\"card-overlay\">";
        echo "\n                        <p class=\"card-text align-middle text-center title-gold\">" . $titles[$slide] . "</p>";
        echo "\n                        <p class=\"card-text align-middle text-center d-none d-lg-block\">" . $captions[$slide] . "</p>";
        echo "\n                      </div>
                    </div>
                  </div>
                  <!-- /.overlay container -->
                </div>
              </div>";
        echo "<!-- /.slide " . ($slide+1) . " -->"; 
        $slide += 1;
      }
      echo "            </div>
            <!-- prev arrow -->
            <a class=\"carousel-control-prev w-auto\" href=\"#circle-carousel\" role=\"button\" data-slide=\"prev\" id=\"circle-prev\">
                <span class=\"carousel-control-prev-icon\" aria-hidden=\"true\"></span>
                <span class=\"sr-only\">Previous</span>
            </a>
            <!-- /.prev arrow -->
            <!-- next arrow -->
            <a class=\"carousel-control-next w-auto\" href=\"#circle-carousel\" role=\"button\" data-slide=\"next\" id=\"circle-next\">
                <span class=\"carousel-control-next-icon\" aria-hidden=\"true\"></span>
                <span class=\"sr-only\">Next</span>
            </a>
            <!-- /.next arrow -->
          </div>
          <!-- /.slides -->\n";
      
    }
  }
    
?>